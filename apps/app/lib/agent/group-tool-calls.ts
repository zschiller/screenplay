import type { AgentMessage } from "@/lib/agent/types"

/** A tool call spawned inside a subagent carries its `Task`'s id (issue #636). */
type ToolCallMessage = Extract<AgentMessage, { role: "tool_call" }>

/**
 * One entry in the grouped timeline: the original message plus, when it's a
 * `Task` tool call that spawned a subagent, the subagent's tool calls folded
 * under it. `children` is empty for every other message — including a `Task`
 * that hasn't emitted any child calls yet — so a caller can treat a non-empty
 * `children` as "render this as a collapsible group".
 *
 * `index` is the message's position in the *flat* input list, preserved so the
 * render layer keeps stable React keys (and can still pair a legacy
 * `tool_use`/`tool_result` by slicing the original array).
 */
export interface GroupedMessage {
  message: AgentMessage
  index: number
  children: { message: ToolCallMessage; index: number }[]
}

/**
 * Fold a flat `AgentMessage[]` into `Task` groups (issue #640).
 *
 * A `tool_call` whose `parentToolCallId` matches a **preceding** top-level
 * `tool_call` nests under it as a child; the spawning call becomes a group.
 * Parallel `Task`s group their own children independently (each child names its
 * own parent by id). A child whose parent id was never seen — or is seen only
 * *after* the child (out of order) — is an **orphan**: it stays at top level
 * rather than vanishing. A transcript with no subagent linkage comes back
 * one-entry-per-message, in order, every `children` empty — i.e. unchanged.
 *
 * Pure and order-preserving: top-level entries keep their input order, and a
 * group's children keep theirs.
 */
export function groupToolCalls(messages: AgentMessage[]): GroupedMessage[] {
  const grouped: GroupedMessage[] = []
  // Top-level `tool_call` id → its entry, so a later child folds under the call
  // that spawned it. Only calls we've already placed at top level are recorded,
  // which is what enforces "a *preceding* Task": a child seen before its parent
  // finds no entry and falls through as an orphan.
  const parents = new Map<string, GroupedMessage>()

  messages.forEach((message, index) => {
    if (message.role === "tool_call" && message.parentToolCallId != null) {
      const parent = parents.get(message.parentToolCallId)
      if (parent) {
        parent.children.push({ message, index })
        return
      }
    }
    const entry: GroupedMessage = { message, index, children: [] }
    grouped.push(entry)
    if (message.role === "tool_call") parents.set(message.toolCallId, entry)
  })

  return grouped
}
