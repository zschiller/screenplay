import { describe, expect, it } from "vitest"

import { harnessToolNaming } from "./harnesses"
import { BARE_TOOL_NAMING, bareToolName, isHarnessPlumbing } from "./tool-name"

describe("bareToolName", () => {
  it("strips a harness's MCP namespace", () => {
    expect(bareToolName("mcp__screenplay__read_canvas")).toBe("read_canvas")
    expect(bareToolName("mcp__my_server__list_changes")).toBe("list_changes")
    expect(bareToolName("Tool: screenplay/read_canvas")).toBe("read_canvas")
    expect(bareToolName("mcp.screenplay.read_canvas")).toBe("read_canvas")
    expect(bareToolName("screenplay_read_canvas")).toBe("read_canvas")
  })

  it("leaves every other title as is", () => {
    expect(bareToolName("read_canvas")).toBe("read_canvas")
    expect(bareToolName("Read `src/a.ts`")).toBe("Read `src/a.ts`")
    expect(bareToolName("ToolSearch")).toBe("ToolSearch")
  })
})

describe("isHarnessPlumbing", () => {
  const call = (
    title: string,
    status: "in_progress" | "completed" | "failed",
    toolCallId = "t"
  ) => ({
    role: "tool_call" as const,
    toolCallId,
    title,
    status,
    content: [],
  })

  it("is a harness's housekeeping in every chat, unless it failed", () => {
    for (const title of [
      "ToolSearch",
      "Ready to code?",
      "Compact conversation",
    ]) {
      expect(isHarnessPlumbing(call(title, "completed"))).toBe(true)
      expect(isHarnessPlumbing(call(title, "failed"))).toBe(false)
    }
    expect(
      isHarnessPlumbing(call("mcp__screenplay__read_canvas", "completed"))
    ).toBe(false)
  })

  it("is Codex's Guardian Review, unless it failed", () => {
    const byId = (status: "in_progress" | "completed" | "failed") =>
      call("Reviewing approval request", status, "guardian_assessment:r1")
    expect(isHarnessPlumbing(byId("completed"))).toBe(true)
    expect(isHarnessPlumbing(byId("in_progress"))).toBe(true)
    expect(isHarnessPlumbing(call("Guardian Review", "completed"))).toBe(true)
    expect(isHarnessPlumbing(byId("failed"))).toBe(false)
    expect(isHarnessPlumbing(call("Guardian Review", "failed"))).toBe(false)
  })

  it("never hides a thinking step for its kind alone", () => {
    expect(
      isHarnessPlumbing({
        ...call("Thinking", "completed"),
        kind: "think" as const,
      })
    ).toBe(false)
  })
})

describe("harnessToolNaming", () => {
  it("names Claude Code's MCP tools exactly, as bareToolName reads them back", () => {
    const naming = harnessToolNaming("claude-code", "screenplay")
    expect(naming.name("read_skill")).toBe("mcp__screenplay__read_skill")
    expect(bareToolName(naming.name("read_skill"))).toBe("read_skill")
    // Skills and tool descriptions name tools bare: the note maps them.
    expect(naming.note).toContain("`mcp__screenplay__<tool>`")
  })

  it("names OpenCode's MCP tools exactly, as bareToolName reads them back (#1589)", () => {
    for (const key of ["opencode-gateway", "opencode-compat"]) {
      const naming = harnessToolNaming(key, "screenplay")
      expect(naming.name("read_skill")).toBe("screenplay_read_skill")
      expect(bareToolName(naming.name("read_skill"))).toBe("read_skill")
      expect(naming.note).toContain("`screenplay_<tool>`")
    }
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
