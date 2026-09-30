import { describe, expect, it } from "vitest"

import { bareToolName, isHarnessPlumbing } from "./tool-name"

describe("bareToolName", () => {
  it("strips a harness's MCP namespace", () => {
    expect(bareToolName("mcp__screenplay__read_canvas")).toBe("read_canvas")
    expect(bareToolName("mcp__my_server__list_changes")).toBe("list_changes")
    expect(bareToolName("Tool: screenplay/read_canvas")).toBe("read_canvas")
  })

  it("leaves every other title as is", () => {
    expect(bareToolName("read_canvas")).toBe("read_canvas")
    expect(bareToolName("Read `src/a.ts`")).toBe("Read `src/a.ts`")
    expect(bareToolName("ToolSearch")).toBe("ToolSearch")
  })
})

describe("isHarnessPlumbing", () => {
  const call = (title: string, status: "completed" | "failed") => ({
    role: "tool_call" as const,
    toolCallId: "t",
    title,
    status,
    content: [],
  })

  it("is Claude Code's tool loading, unless it failed", () => {
    expect(isHarnessPlumbing(call("ToolSearch", "completed"))).toBe(true)
    expect(isHarnessPlumbing(call("ToolSearch", "failed"))).toBe(false)
    expect(
      isHarnessPlumbing(call("mcp__screenplay__read_canvas", "completed"))
    ).toBe(false)
  })
})
