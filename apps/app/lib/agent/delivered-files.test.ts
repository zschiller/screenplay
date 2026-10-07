import { describe, expect, it } from "vitest"

import { deliveredFileOf, deliveredFiles } from "./delivered-files"
import type { AgentMessage } from "@/lib/agent/types"

type ToolCall = Extract<AgentMessage, { role: "tool_call" }>

function call(
  title: string,
  result: string,
  rawInput: object = {},
  status: ToolCall["status"] = "completed"
): ToolCall {
  return {
    role: "tool_call",
    toolCallId: `${title}-${result}`,
    title,
    status,
    rawInput,
    content: [
      { type: "content", content: { type: "text", text: result } },
    ] as ToolCall["content"],
  }
}

describe("deliveredFileOf (#1885)", () => {
  it("names what a create made, placed or not", () => {
    expect(
      deliveredFileOf(call("create_mockup", 'Created Mockup "A" (id m-1).'))
    ).toBe("m-1")
    expect(
      deliveredFileOf(
        call(
          "mcp__screenplay__create_document",
          'Created document "B" (id d-1), not on the canvas.'
        )
      )
    ).toBe("d-1")
  })

  it("names what a write changed, by its argument", () => {
    expect(
      deliveredFileOf(
        call("update_mockup", "Updated Mockup m-1.", { mockup_id: "m-1" })
      )
    ).toBe("m-1")
    expect(
      deliveredFileOf(
        call("append_to_document_body", "Appended 4 characters", {
          document_id: "d-1",
        })
      )
    ).toBe("d-1")
  })

  it("names nothing for a read, a refusal, a failure or a call still running", () => {
    expect(
      deliveredFileOf(call("read_mockup", "# A", { mockup_id: "m-1" }))
    ).toBeNull()
    expect(
      deliveredFileOf(
        call("update_mockup", "Other is changing this right now", {
          mockup_id: "m-1",
        })
      )
    ).toBeNull()
    expect(
      deliveredFileOf(
        call("create_mockup", 'Created Mockup "A" (id m-1).', {}, "failed")
      )
    ).toBeNull()
    expect(
      deliveredFileOf(
        call("create_mockup", 'Created Mockup "A" (id m-1).', {}, "in_progress")
      )
    ).toBeNull()
  })
})

describe("deliveredFiles", () => {
  it("lists each file once, in the order first delivered", () => {
    expect(
      deliveredFiles([
        call("create_mockup", 'Created Mockup "A" (id m-1).'),
        call("create_document", 'Created document "B" (id d-1).'),
        call("update_mockup", "Updated Mockup m-1.", { mockup_id: "m-1" }),
      ])
    ).toEqual(["m-1", "d-1"])
  })
})
