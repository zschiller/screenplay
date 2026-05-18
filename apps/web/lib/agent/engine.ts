import "server-only"

import {
  hasToolCall,
  stepCountIs,
  streamText,
  type ModelMessage,
} from "ai"
import type { Tool } from "ai"
import { resolveLanguageModel } from "./providers"
import type { ToolContext } from "@/lib/agent/tool-executor"
import { buildAgentTools } from "./tools"
import {
  appendMessages,
  endRun,
  isRunAborted,
  savePendingToolCall,
} from "./persistence"
import { broadcastEvent, broadcastSignal, StreamBroadcaster } from "./broadcast"

const MAX_STEPS = 20
const ABORT_POLL_INTERVAL_MS = 250

export interface RunAgentLoopOptions {
  chatId: string
  runId: string
  roomId: string
  systemPrompt: string
  model: string
  /**
   * Tool context for the default sandbox-backed toolset. Required when
   * `tools` is omitted; ignored when callers supply their own tools (e.g.
   * the document-targeted flow).
   */
  toolCtx?: ToolContext
  /**
   * Pre-built tools object — typed loosely so per-target toolsets (agent
   * sandbox tools, document-mutation tools, future kinds) all fit. Defaults
   * to `buildAgentTools(toolCtx)` when omitted.
   */
  tools?: Record<string, Tool>
  /** Full conversation, including the just-appended user message or tool result. */
  messages: ModelMessage[]
}

/**
 * Drive a streamText tool loop to completion, persisting every assistant +
 * tool message produced and broadcasting deltas via the existing Y.Doc
 * channel. Halts cleanly on submit_plan, hard-stops on the run's abort flag.
 *
 * Shared between the initial /stream call and the /plan resume — the only
 * difference between those two cases is what the caller appends to
 * `messages` before invoking us.
 */
export async function runAgentLoop(opts: RunAgentLoopOptions): Promise<void> {
  const { chatId, runId, roomId, systemPrompt, model, toolCtx, messages } = opts
  const broadcaster = new StreamBroadcaster(roomId, chatId)
  const tools =
    opts.tools ??
    (toolCtx
      ? buildAgentTools(toolCtx)
      : (() => {
          throw new Error("runAgentLoop: either `tools` or `toolCtx` must be provided")
        })())

  // Watchdog: poll the abort flag and trigger AbortController if /stop has
  // flipped it since we started. Cleared in the finally block.
  const controller = new AbortController()
  const watchdog = setInterval(async () => {
    try {
      if (await isRunAborted(runId)) controller.abort()
    } catch {
      // Transient DB blip — keep going. /stop will retry effectively on next
      // tick if it actually wrote.
    }
  }, ABORT_POLL_INTERVAL_MS)

  try {
    const result = streamText({
      model: resolveLanguageModel(model),
      system: systemPrompt,
      messages,
      tools,
      stopWhen: [stepCountIs(MAX_STEPS), hasToolCall("submit_plan")],
      abortSignal: controller.signal,

      onChunk: async ({ chunk }) => {
        // Drop chunks the model already buffered before the abort propagated
        // — without this guard, /stop produces a flurry of late text/tool
        // events that keep growing the message list after the user thinks
        // the turn is over.
        if (controller.signal.aborted) return
        switch (chunk.type) {
          case "text-delta":
            await broadcaster.onTextDelta(chunk.id, chunk.text)
            break
          case "tool-call":
            await broadcaster.onToolCall(chunk.toolName, chunk.input)
            break
          case "tool-result":
            await broadcaster.onToolResult(chunk.toolName, chunk.output)
            break
        }
      },

      onError: async ({ error }) => {
        await broadcaster.onError(
          error instanceof Error ? error.message : String(error),
        )
      },

      onStepFinish: async ({ response }) => {
        // Persist messages this step produced (assistant + any tool messages).
        await appendMessages(chatId, response.messages)
        // Each step boundary is a logical break in the assistant's text. Reset
        // the broadcaster's text-block buffer so the next step's text starts a
        // fresh assistant message client-side.
        broadcaster.startNewTextBlock()
      },

      onFinish: async ({ response, finishReason, steps }) => {
        // If we halted on submit_plan, find that tool call and persist a
        // pending row + emit plan_submitted. The hasToolCall stop condition
        // fires when the most recent assistant message in `response.messages`
        // contains a submit_plan tool call.
        const planCall = findSubmitPlanCall(response.messages)
        if (planCall) {
          const planId = await savePendingToolCall({
            runId,
            chatId,
            toolCallId: planCall.toolCallId,
            toolName: "submit_plan",
            input: planCall.input as Record<string, unknown>,
          })
          await endRun(runId, "paused_for_plan")
          await broadcastEvent(roomId, chatId, {
            type: "plan_submitted",
            planId,
            plan: (planCall.input as { plan: string }).plan,
            toolEventId: planCall.toolCallId,
          })
          await broadcastSignal(roomId, chatId, "chat-stream-end")
          return
        }

        await endRun(runId, "ended")
        await broadcastEvent(roomId, chatId, { type: "done" })
        await broadcastSignal(roomId, chatId, "chat-stream-end")

        // Suppress unused warning for finishReason / steps — kept in the
        // signature so callers have a hook if they want to log usage later.
        void finishReason
        void steps
      },
    })

    // Drain the stream so onChunk / onFinish actually run. We don't pipe the
    // stream to the HTTP response — the client receives state via the Y.Doc
    // broadcaster instead.
    await result.consumeStream()
  } catch (e) {
    if (controller.signal.aborted) {
      // Aborted runs broadcast 'error' + chat-stream-end so the UI unsticks.
      await broadcaster.onError("Stopped by user")
    } else {
      await broadcaster.onError(e instanceof Error ? e.message : String(e))
    }
    await endRun(runId, "ended")
    await broadcastSignal(roomId, chatId, "chat-stream-end")
  } finally {
    clearInterval(watchdog)
  }
}

/**
 * Scan a freshly produced ModelMessage[] for an unresolved submit_plan tool
 * call. Returns the call data or null. Used by `runAgentLoop` to detect the
 * `hasToolCall('submit_plan')` halt and pivot into pending-plan mode.
 */
function findSubmitPlanCall(
  messages: ModelMessage[],
): { toolCallId: string; input: unknown } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg || msg.role !== "assistant") continue
    if (typeof msg.content === "string") continue
    for (const part of msg.content) {
      if (
        part.type === "tool-call" &&
        "toolName" in part &&
        part.toolName === "submit_plan"
      ) {
        return { toolCallId: part.toolCallId, input: part.input }
      }
    }
  }
  return null
}

/**
 * Build a ModelMessage representing the human-side resolution of a
 * submit_plan tool call (approval or rejection with feedback). Appended to
 * the conversation before resuming the loop in /api/agent/plan.
 */
export function buildPlanToolResultMessage(opts: {
  toolCallId: string
  approved: boolean
  feedback?: string
}): ModelMessage {
  const text = opts.approved
    ? "Plan approved. Proceed with execution."
    : `Plan rejected. User feedback: ${opts.feedback ?? "No feedback provided"}. Please revise your plan and call submit_plan again.`

  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: opts.toolCallId,
        toolName: "submit_plan",
        output: { type: "text", value: text },
      },
    ],
  }
}

/**
 * Build a fresh user ModelMessage for the initial stream call.
 * `id` is generated separately by callers that need to track it.
 */
export function buildUserMessage(text: string): ModelMessage {
  return { role: "user", content: text }
}

