import type { AgentMessage } from "@/lib/agent/types"
import { bareToolName } from "@/lib/agent/tool-name"

/**
 * The Coordinator's Plan mode. With Plan on, the Coordinator starts, messages,
 * stops and arranges nothing. It calls `propose_plan` with the chats it would
 * start, what it would send each, and any canvas changes, and the chat draws
 * that as a Plan card. Approve sends {@link PLAN_APPROVAL} as the user's next
 * message, outside plan mode, and the Coordinator carries the plan out. Like a
 * Question Card, nothing is stored beyond the tool call: a card is settled
 * once a user message follows it.
 *
 * Client-safe: the card and the tool share this module.
 */

export const PROPOSE_PLAN_TOOL = "propose_plan"

/** The message Approve sends, word for word. */
export const PLAN_APPROVAL = "Approved. Go ahead with the plan."

type ToolCallMessage = Extract<AgentMessage, { role: "tool_call" }>

export function isPlanProposal(message: AgentMessage): boolean {
  return (
    message.role === "tool_call" &&
    bareToolName(message.title) === PROPOSE_PLAN_TOOL
  )
}

/** A proposal's markdown, or null while it streams or when it's empty. */
export function parseProposedPlan(input: unknown): string | null {
  if (!input || typeof input !== "object") return null
  const plan = (input as Record<string, unknown>).plan
  return typeof plan === "string" && plan.trim() ? plan.trim() : null
}

/**
 * What became of each proposal in a transcript, by tool call id: `approved`
 * when the first user message after it is {@link PLAN_APPROVAL}, `replaced`
 * when it's anything else. A wake or a PR event is the server's message, not
 * the user's, so it settles nothing. A proposal no user message follows yet is
 * left out: its card still offers Approve.
 */
export function planProposalOutcomes(
  messages: readonly AgentMessage[]
): Map<string, "approved" | "replaced"> {
  const outcomes = new Map<string, "approved" | "replaced">()
  let open: ToolCallMessage[] = []
  for (const message of messages) {
    if (message.role === "tool_call" && isPlanProposal(message)) {
      open.push(message)
    } else if (
      message.role === "user" &&
      !message.wakeFrom &&
      !message.prEvent
    ) {
      const outcome =
        message.content.trim() === PLAN_APPROVAL ? "approved" : "replaced"
      for (const call of open) outcomes.set(call.toolCallId, outcome)
      open = []
    }
  }
  return outcomes
}
