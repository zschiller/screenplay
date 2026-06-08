import { stepCountIs, streamText, type StreamTextResult, type Tool } from "ai"
import { resolveLanguageModel } from "../providers"
import {
  acpHistoryToModelMessages,
  aiSdkChunkToAcpUpdate,
  cachedSystem,
  withConversationCacheBreakpoint,
} from "./adapter"
import type {
  Engine,
  EngineTurn,
  EngineUpdateSink,
  PromptCacheUsage,
  UsageReportingEngine,
} from "./engine-seam"
import type { StopReason } from "./schema"

const MAX_STEPS = 20

/**
 * The `streamText` surface the engine depends on — the same injection seam as
 * the legacy loop's `StreamDriver`, so the contract test drives finish/error
 * paths without a live model.
 */
export type StreamDriver = (
  config: Parameters<typeof streamText>[0]
) => Pick<StreamTextResult<Record<string, Tool>, never>, "consumeStream">

/**
 * The in-process AI-SDK Engine (ADR 0006), now a **translator**: it keeps the
 * `streamText` body, but (a) rebuilds its `ModelMessage[]` input from
 * ACP-native history and (b) emits ACP `session/update`s (and the terminal
 * `stopReason`) to the seam's sink instead of driving the bespoke
 * `AgentStreamEvent` wire format. The ACP-update consumer turns those into
 * broadcasts, ACP-native persistence, and run-state transitions.
 *
 * It declares the prompt-cache usage capability ({@link UsageReportingEngine}):
 * `onFinish`'s `totalUsage` is captured and exposed via {@link lastTurnUsage},
 * which the caller reads only after narrowing through `supportsUsageReporting`.
 * A generic ACP agent that can't surface usage simply omits the capability.
 *
 * This slice implements the **text path** (`agent_message_chunk` + `done`);
 * tool-call and plan translation arrive in later slices, at which point this
 * engine replaces the legacy `runAgentLoop` outright.
 */
export class InProcessAiSdkEngine implements UsageReportingEngine {
  readonly id = "in-process-ai-sdk"
  readonly reportsUsage = true

  private usage: PromptCacheUsage | null = null

  /** Injected for tests; defaults to the real `streamText`. */
  constructor(private readonly startStream: StreamDriver = streamText) {}

  lastTurnUsage(): PromptCacheUsage | null {
    return this.usage
  }

  async run(
    turn: EngineTurn,
    sink: EngineUpdateSink,
    signal: AbortSignal
  ): Promise<void> {
    this.usage = null
    // Deterministic, cache-stable rebuild of the model's input from ACP-native
    // history (the carried prompt-cache risk — see the adapter).
    const messages = withConversationCacheBreakpoint(
      acpHistoryToModelMessages(turn.history)
    )

    try {
      const result = this.startStream({
        model: resolveLanguageModel(turn.model),
        system: cachedSystem(turn.systemPrompt),
        messages,
        tools: turn.tools,
        stopWhen: [stepCountIs(MAX_STEPS)],
        abortSignal: signal,

        onChunk: async ({ chunk }) => {
          // Drop chunks the model buffered before the abort propagated, so a
          // `/stop` doesn't keep streaming text after the user stopped.
          if (signal.aborted) return
          const update = aiSdkChunkToAcpUpdate(chunk)
          if (update) await sink({ kind: "session_update", update })
        },

        onError: async ({ error }) => {
          await sink({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          })
        },

        onFinish: async ({ finishReason, totalUsage }) => {
          this.usage = {
            inputTokens: totalUsage?.inputTokens,
            outputTokens: totalUsage?.outputTokens,
            cacheReadTokens: totalUsage?.inputTokenDetails?.cacheReadTokens,
            cacheWriteTokens: totalUsage?.inputTokenDetails?.cacheWriteTokens,
          }
          await sink({ kind: "done", stopReason: toStopReason(finishReason) })
        },
      })

      await result.consumeStream()
    } catch (e) {
      if (signal.aborted) {
        // The run is no longer live (user `/stop` or supersession). Report it
        // as a stop, not a failure — the consumer's `failed` transition no-ops
        // on the already-terminal run.
        await sink({ kind: "error", message: "Stopped by user" })
      } else {
        await sink({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }
}

/** Map an AI-SDK `finishReason` onto the ACP `PromptResponse.stopReason`. */
function toStopReason(finishReason: string | undefined): StopReason {
  switch (finishReason) {
    case "length":
      return "max_tokens"
    case "content-filter":
      return "refusal"
    default:
      // `stop`, `tool-calls`, `unknown`, … all map to a normal end of turn.
      return "end_turn"
  }
}

/** The default in-process engine bound to the real `streamText`. */
export const inProcessEngine: Engine = new InProcessAiSdkEngine()
