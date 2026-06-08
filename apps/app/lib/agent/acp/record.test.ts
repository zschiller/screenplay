import { describe, expect, it } from "vitest"

import { repairOrphanedAcpToolCalls, type AcpMessageRecord } from "./record"
import { acpHistoryToModelMessages } from "./adapter"
import { textBlock, type ToolCallContent } from "./schema"

const interrupted: ToolCallContent = {
  type: "content",
  content: textBlock("Tool execution was interrupted."),
}

/** A tool-call record frozen in `status`, as a crash mid-turn would leave it. */
function toolCall(
  toolCallId: string,
  status: "pending" | "in_progress" | "completed" | "failed",
  content: ToolCallContent[] = []
): AcpMessageRecord {
  return {
    role: "tool_call",
    toolCallId,
    title: "run_command",
    status,
    content,
  }
}

describe("repairOrphanedAcpToolCalls", () => {
  it("closes a non-terminal tool call to failed with an interrupted marker", async () => {
    for (const status of ["pending", "in_progress"] as const) {
      const repaired = repairOrphanedAcpToolCalls([toolCall("x", status)])
      expect(repaired).toEqual<AcpMessageRecord[]>([
        {
          role: "tool_call",
          toolCallId: "x",
          title: "run_command",
          status: "failed",
          content: [interrupted],
        },
      ])
    }
  })

  it("preserves the call's existing content, appending the marker after it", async () => {
    const out: ToolCallContent = {
      type: "content",
      content: textBlock("partial output"),
    }
    const repaired = repairOrphanedAcpToolCalls([
      toolCall("x", "in_progress", [out]),
    ])
    expect(repaired[0]).toMatchObject({
      status: "failed",
      content: [out, interrupted],
    })
  })

  it("leaves terminal tool calls and non-tool records untouched", async () => {
    const history: AcpMessageRecord[] = [
      { role: "user", content: [textBlock("hi")] },
      toolCall("done", "completed", [
        { type: "content", content: textBlock("ok") },
      ]),
      toolCall("flopped", "failed"),
      { role: "agent", content: [textBlock("there")] },
    ]
    // A clean log is returned structurally unchanged.
    expect(repairOrphanedAcpToolCalls(history)).toEqual(history)
  })

  it("is idempotent — repairing an already-repaired log is a no-op", async () => {
    const once = repairOrphanedAcpToolCalls([toolCall("x", "in_progress")])
    const twice = repairOrphanedAcpToolCalls(once)
    // The marker is appended exactly once, never re-appended on a second pass.
    expect(twice).toEqual(once)
  })

  // The durability invariant: a crashed turn's ACP-native log — a tool call the
  // consumer upserted in place and never closed — loads back into a well-formed
  // conversation. We model the persistence round-trip as a structural clone (the
  // jsonb column stores the record verbatim), repair on load, and assert no
  // orphan survives and the model rebuild carries no unresolved tool call.
  it("the orphaned-tool-call repair invariant survives an ACP-native round-trip", async () => {
    const crashed: AcpMessageRecord[] = [
      { role: "user", content: [textBlock("run the build")] },
      { role: "agent", content: [textBlock("On it.")] },
      // The crash froze this one mid-flight: upserted `in_progress`, never closed.
      toolCall("call_1", "in_progress", [
        { type: "content", content: textBlock("building…") },
      ]),
    ]

    // Persisted then reloaded — jsonb round-trips the record structurally.
    const reloaded = structuredClone(crashed)
    const repaired = repairOrphanedAcpToolCalls(reloaded)

    // No tool call is left in a non-terminal status after the round-trip.
    const stuck = repaired.filter(
      (r) =>
        r.role === "tool_call" &&
        r.status !== "completed" &&
        r.status !== "failed"
    )
    expect(stuck).toEqual([])

    // The repaired call is failed and marked interrupted, content preserved.
    expect(repaired[2]).toEqual<AcpMessageRecord>({
      role: "tool_call",
      toolCallId: "call_1",
      title: "run_command",
      status: "failed",
      content: [
        { type: "content", content: textBlock("building…") },
        interrupted,
      ],
    })

    // Rebuilding the model input from the repaired log is well-formed: the text
    // turns survive and the once-orphaned call rebuilds into an assistant
    // tool-call + matching tool result (closed with the interrupted marker), so
    // no dangling unresolved call reaches the next prompt.
    expect(acpHistoryToModelMessages(repaired)).toEqual([
      { role: "user", content: "run the build" },
      { role: "assistant", content: "On it." },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "run_command",
            input: {},
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "run_command",
            output: {
              type: "text",
              value: "building…Tool execution was interrupted.",
            },
          },
        ],
      },
    ])
  })
})
