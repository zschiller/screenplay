import { describeToolCall } from "@/lib/agent/tool-description"
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
 * render layer keeps stable React keys.
 */
export interface GroupedMessage {
  message: AgentMessage
  index: number
  children: { message: ToolCallMessage; index: number }[]
  /**
   * Set on a Frame Drive folded into one row ({@link foldFrameDrives}):
   * `children` are then all its steps, `message` the first of them.
   */
  drive?: true
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

/** A Frame Drive step, with the frame it drives and whether it acts on it. */
function driveStep(
  entry: GroupedMessage
): { call: ToolCallMessage; frameId: string; gesture: boolean } | null {
  const m = entry.message
  if (m.role !== "tool_call" || entry.children.length > 0) return null
  const { driveStep, frameId, gesture } = describeToolCall(m)
  return driveStep ? { call: m, frameId, gesture } : null
}

/**
 * Fold each Frame Drive into one entry: back-to-back steps on the same frame
 * that act on the page at least once. The person watches the frame while
 * the agent drives it, so a row per click repeats what they just saw. A run
 * of steps with no gesture (only reads of the page) stays as it is, and so
 * does a lone step.
 */
export function foldFrameDrives(entries: GroupedMessage[]): GroupedMessage[] {
  const out: GroupedMessage[] = []
  let run: GroupedMessage[] = []
  const flush = () => {
    const steps = run.map((e) => driveStep(e)!)
    if (run.length > 1 && steps.some((s) => s.gesture)) {
      out.push({
        message: run[0]!.message,
        index: run[0]!.index,
        children: run.map((e, i) => ({
          message: steps[i]!.call,
          index: e.index,
        })),
        drive: true,
      })
    } else out.push(...run)
    run = []
  }
  for (const entry of entries) {
    const step = driveStep(entry)
    const last = run.at(-1)
    if (step && (!last || driveStep(last)!.frameId === step.frameId)) {
      run.push(entry)
      continue
    }
    flush()
    if (step) run.push(entry)
    else out.push(entry)
  }
  flush()
  return out
}
