import { describe, expect, it } from "vitest"

import { groupToolCalls } from "./group-tool-calls"
import type { AgentMessage } from "@/lib/agent/types"

/** A `tool_call` message, defaulting the noise so a case reads as its shape. */
function call(
  toolCallId: string,
  partial: Partial<Extract<AgentMessage, { role: "tool_call" }>> = {}
): AgentMessage {
  return {
    role: "tool_call",
    toolCallId,
    title: "run_command",
    status: "completed",
    content: [],
    ...partial,
  }
}

describe("groupToolCalls (issue #640)", () => {
  it("nests a child under the preceding matching Task", () => {
    const task = call("task_1", { title: "Task" })
    const child = call("child_1", { parentToolCallId: "task_1" })
    const messages: AgentMessage[] = [task, child]

    const grouped = groupToolCalls(messages)

    // One top-level entry (the Task), with the child folded under it.
    expect(grouped).toHaveLength(1)
    expect(grouped[0].message).toBe(task)
    expect(grouped[0].children).toEqual([{ message: child, index: 1 }])
  })

  it("keeps an orphan (parent absent) at top level rather than dropping it", () => {
    const orphan = call("child_1", { parentToolCallId: "never_seen" })
    const messages: AgentMessage[] = [orphan]

    const grouped = groupToolCalls(messages)

    expect(grouped).toHaveLength(1)
    expect(grouped[0].message).toBe(orphan)
    expect(grouped[0].children).toEqual([])
  })

  it("keeps a child seen before its parent at top level (parent must precede)", () => {
    // The parent arrives *after* the child, so at the child's turn there is no
    // preceding Task to nest under — it stays flat, and the later Task groups
    // nothing.
    const early = call("child_1", { parentToolCallId: "task_1" })
    const task = call("task_1", { title: "Task" })
    const messages: AgentMessage[] = [early, task]

    const grouped = groupToolCalls(messages)

    expect(grouped.map((g) => g.message)).toEqual([early, task])
    expect(grouped.every((g) => g.children.length === 0)).toBe(true)
  })

  it("groups two parallel Tasks' children independently by parent id", () => {
    const taskA = call("task_a", { title: "Task" })
    const taskB = call("task_b", { title: "Task" })
    const a1 = call("a1", { parentToolCallId: "task_a" })
    const b1 = call("b1", { parentToolCallId: "task_b" })
    const a2 = call("a2", { parentToolCallId: "task_a" })
    // Interleaved arrival, as two subagents running at once would emit.
    const messages: AgentMessage[] = [taskA, taskB, a1, b1, a2]

    const grouped = groupToolCalls(messages)

    expect(grouped.map((g) => g.message)).toEqual([taskA, taskB])
    expect(grouped[0].children.map((c) => c.message)).toEqual([a1, a2])
    expect(grouped[1].children.map((c) => c.message)).toEqual([b1])
  })

  it("returns a subagent-free transcript unchanged (one entry per message, no children)", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "on it" },
      call("call_1", { title: "read_file" }),
      call("call_2", { title: "edit_file" }),
    ]

    const grouped = groupToolCalls(messages)

    expect(grouped.map((g) => g.message)).toEqual(messages)
    expect(grouped.map((g) => g.index)).toEqual([0, 1, 2, 3])
    expect(grouped.every((g) => g.children.length === 0)).toBe(true)
  })
})
