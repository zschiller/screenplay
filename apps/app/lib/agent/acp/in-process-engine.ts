import {
  stepCountIs,
  streamText,
  type ModelMessage,
  type StreamTextResult,
  type Tool,
} from "ai"
import { resolveLanguageModel } from "../providers"
import {
  acpHistoryToModelMessages,
  aiSdkChunkToAcpUpdate,
  cachedSystem,
  recordText,
  withConversationCacheBreakpoint,
} from "./adapter"
import type {
  Engine,
  EngineTurn,
  EngineUpdateSink,
  PromptCacheUsage,
  SteeringEngine,
  TakenSteer,
  UsageReportingEngine,
} from "./engine-seam"
import {
  planPermissionRequest,
  SUBMIT_PLAN_TOOL,
  type StopReason,
} from "./schema"

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
 * It translates the **text path** (`agent_message_chunk` + `done`), the
 * **tool-call lifecycle** (`tool_call` + `tool_call_update`, status keyed by id
 * — issue #377; the {@link aiSdkChunkToAcpUpdate} adapter does the per-chunk
 * mapping), and the **plan-mode gate** — a `submit_plan` tool-call becomes an
 * ACP `permission_request` (see {@link planPermissionRequest}), distinct from
 * ACP's informational `plan` update and handled ahead of the generic tool path.
 * At this point this engine can replace the legacy `runAgentLoop` outright.
 */
export class InProcessEngine implements UsageReportingEngine, SteeringEngine {
  readonly id = "in-process"
  readonly reportsUsage = true
  readonly steers = true

  private usage: PromptCacheUsage | null = null

  /** Injected for tests; defaults to the real `streamText`. */
  constructor(private readonly startStream: StreamDriver = streamText) {}

  lastTurnUsage(): PromptCacheUsage | null {
    return this.usage
  }

  /**
   * Drive one turn. Steers (#1190) are taken at every step boundary through
   * `prepareStep` and handed to the model as one user message before its next
   * step. A turn that would otherwise finish checks once more and, when some
   * are waiting, carries on with them in a further `streamText` call over the
   * conversation so far, so nothing sent mid-turn is left for the next turn
   * while this one could still read it.
   */
  async run(
    turn: EngineTurn,
    sink: EngineUpdateSink,
    signal: AbortSignal
  ): Promise<void> {
    this.usage = null
    // No session to open: every run of this engine takes Steers (#1250).
    if (turn.takeSteers) await turn.reportSteering?.(true)
    // Deterministic, cache-stable rebuild of the model's input from ACP-native
    // history (the carried prompt-cache risk — see the adapter).
    let messages = withConversationCacheBreakpoint(
      acpHistoryToModelMessages(turn.history)
    )
    const takeSteers = async (): Promise<ModelMessage | null> => {
      if (!turn.takeSteers || signal.aborted) return null
      const steers = await turn.takeSteers()
      return steers.length > 0 ? steersToModelMessage(steers) : null
    }

    try {
      let stepsLeft = MAX_STEPS
      for (;;) {
        const pass = await this.stream(
          turn,
          messages,
          stepsLeft,
          sink,
          signal,
          {
            takeSteers,
          }
        )
        if (pass.outcome !== "finished") return
        stepsLeft -= pass.steps
        const steer = stepsLeft > 0 ? await takeSteers() : null
        if (!steer) {
          await sink({ kind: "done", stopReason: pass.stopReason })
          return
        }
        messages = [...pass.messages, steer]
      }
    } catch (e) {
      if (signal.aborted) {
        // The run is no longer live (user `/stop` or supersession). Report it
        // as a clean cancellation, not a failure: Turn Launch decides what a
        // stopped or superseded run shows, and it is never an error.
        await sink({ kind: "done", stopReason: "cancelled" })
      } else {
        await sink({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  /**
   * One `streamText` pass over `messages`, translating its chunks to ACP.
   * Resolves `finished` with the conversation it ended on (Steers it took
   * included, where it took them), or `halted` when the pass ended the turn
   * itself: a stream error or a plan gate, both already reported to the sink.
   */
  private async stream(
    turn: EngineTurn,
    messages: ModelMessage[],
    maxSteps: number,
    sink: EngineUpdateSink,
    signal: AbortSignal,
    steering: { takeSteers: () => Promise<ModelMessage | null> }
  ): Promise<
    | {
        outcome: "finished"
        stopReason: StopReason
        messages: ModelMessage[]
        steps: number
      }
    | { outcome: "halted" }
  > {
    // Steers taken during this pass, each at the index of the step input it
    // joined. `prepareStep`'s messages override lasts one step, and each
    // step's input is the pass's messages plus its responses so far, so they
    // are spliced back in at the same places every step.
    const taken: Array<{ at: number; message: ModelMessage }> = []
    // How the pass ended, set from the stream's callbacks.
    const end: {
      gated?: boolean
      errored?: boolean
      finish?: PassFinish
    } = {}

    const result = this.startStream({
      model: resolveLanguageModel(turn.model),
      system: cachedSystem(turn.systemPrompt),
      messages,
      tools: turn.tools,
      stopWhen: [stepCountIs(maxSteps)],
      abortSignal: signal,

      prepareStep: async ({ messages: stepInput }) => {
        const steer = await steering.takeSteers()
        if (steer) taken.push({ at: stepInput.length, message: steer })
        return taken.length > 0
          ? { messages: withSteers(stepInput, taken) }
          : undefined
      },

      onChunk: async ({ chunk }) => {
        // Drop chunks the model buffered before the abort propagated, so a
        // `/stop` doesn't keep streaming text after the user stopped.
        if (signal.aborted) return
        // The plan gate streams its arguments first (`tool-input-start`,
        // then `tool-input-delta`s) before the final `tool-call`. Drop that
        // opening chunk: left alone it becomes a `pending` `tool_call` update
        // that the gate — intercepted just below into a permission request,
        // never a `tool_call_update` — leaves uncompleted, so the chip spins
        // forever (and reads "Submit Plan" off the title-case fallback). The
        // `tool-input-delta`s carry no ACP signal already, so suppressing the
        // start is enough; the gate surfaces solely as the permission request.
        if (
          chunk.type === "tool-input-start" &&
          chunk.toolName === SUBMIT_PLAN_TOOL
        ) {
          return
        }
        // A `submit_plan` tool-call is screenplay's plan-mode approval gate.
        // Translate it to an ACP permission request — *not* an informational
        // `plan` update — so it maps onto `pauseForPlan` downstream (PRD #375,
        // design goal 1). The model halts after it (the tool has no result),
        // and the consumer ignores the subsequent `done` once paused.
        if (chunk.type === "tool-call" && chunk.toolName === SUBMIT_PLAN_TOOL) {
          end.gated = true
          await sink({
            kind: "permission_request",
            request: planPermissionRequest({
              sessionId: turn.chatId,
              toolCallId: chunk.toolCallId,
              plan: String(
                (chunk.input as { plan?: unknown } | undefined)?.plan ?? ""
              ),
            }),
          })
          return
        }
        const update = aiSdkChunkToAcpUpdate(chunk)
        if (update) await sink({ kind: "session_update", update })
      },

      onError: async ({ error }) => {
        end.errored = true
        await sink({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        })
      },

      onFinish: async ({ finishReason, totalUsage, response, steps }) => {
        this.addUsage({
          inputTokens: totalUsage?.inputTokens,
          outputTokens: totalUsage?.outputTokens,
          cacheReadTokens: totalUsage?.inputTokenDetails?.cacheReadTokens,
          cacheWriteTokens: totalUsage?.inputTokenDetails?.cacheWriteTokens,
        })
        end.finish = {
          stopReason: toStopReason(finishReason),
          responseMessages: response?.messages ?? [],
          steps: steps?.length ?? 1,
        }
      },
    })

    await result.consumeStream()
    // A stream the abort cut short throws on some paths and ends quietly on
    // others; either way a stopped run reports a clean cancellation.
    if (signal.aborted) throw new Error("aborted")
    const { finish } = end
    if (end.errored || !finish) return { outcome: "halted" }
    if (end.gated) {
      // The plan gate ended the turn; the consumer, already paused, ignores
      // this `done`.
      await sink({ kind: "done", stopReason: finish.stopReason })
      return { outcome: "halted" }
    }
    return {
      outcome: "finished",
      stopReason: finish.stopReason,
      messages: withSteers([...messages, ...finish.responseMessages], taken),
      steps: finish.steps,
    }
  }

  /** Sum usage across a turn's passes; a turn with one pass reports it as is. */
  private addUsage(pass: PromptCacheUsage): void {
    const prev = this.usage
    if (!prev) {
      this.usage = pass
      return
    }
    const add = (a?: number, b?: number) =>
      a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0)
    this.usage = {
      inputTokens: add(prev.inputTokens, pass.inputTokens),
      outputTokens: add(prev.outputTokens, pass.outputTokens),
      cacheReadTokens: add(prev.cacheReadTokens, pass.cacheReadTokens),
      cacheWriteTokens: add(prev.cacheWriteTokens, pass.cacheWriteTokens),
    }
  }
}

interface PassFinish {
  stopReason: StopReason
  /** Every step's response messages, in order. */
  responseMessages: ModelMessage[]
  steps: number
}

/**
 * The Steers the engine took at one boundary, as the single user message the
 * model reads: each Steer's text, oldest first, a blank line apart.
 */
export function steersToModelMessage(steers: TakenSteer[]): ModelMessage {
  return {
    role: "user",
    content: steers
      .map((s) => recordText({ role: "user", content: s.content }))
      .join("\n\n"),
  }
}

/** Splice taken Steers back into a step's input at the indices they joined. */
function withSteers(
  input: ModelMessage[],
  taken: Array<{ at: number; message: ModelMessage }>
): ModelMessage[] {
  if (taken.length === 0) return input
  const out: ModelMessage[] = []
  let next = 0
  for (const { at, message } of taken) {
    out.push(...input.slice(next, at), message)
    next = at
  }
  out.push(...input.slice(next))
  return out
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
export const inProcessEngine: Engine = new InProcessEngine()
