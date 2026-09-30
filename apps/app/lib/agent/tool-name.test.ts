import { describe, expect, it } from "vitest"

import {
  BARE_TOOL_NAMING,
  bareToolName,
  harnessToolNaming,
  isHarnessPlumbing,
} from "./tool-name"

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

describe("harnessToolNaming", () => {
  it("names Claude Code's MCP tools exactly, as bareToolName reads them back", () => {
    const naming = harnessToolNaming("claude-code", "screenplay")
    expect(naming.name("read_skill")).toBe("mcp__screenplay__read_skill")
    expect(bareToolName(naming.name("read_skill"))).toBe("read_skill")
    expect(naming.note).toBeUndefined()
  })

  it("keeps bare names on other harnesses and says where the tools come from", () => {
    const naming = harnessToolNaming("codex", "screenplay")
    expect(naming.name("read_skill")).toBe("read_skill")
    expect(naming.note).toContain("MCP server `screenplay`")
  })

  it("names every tool bare on the in-process engine", () => {
    expect(BARE_TOOL_NAMING.name("read_skill")).toBe("read_skill")
    expect(BARE_TOOL_NAMING.note).toBeUndefined()
  })
})
