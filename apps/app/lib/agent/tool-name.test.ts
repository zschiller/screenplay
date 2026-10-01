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
  const coordinator = { coordinator: true }
  const workspace = { coordinator: false }

  it("is Claude Code's tool loading in the Coordinator's chat, unless it failed", () => {
    expect(
      isHarnessPlumbing(call("ToolSearch", "completed"), coordinator)
    ).toBe(true)
    expect(isHarnessPlumbing(call("ToolSearch", "failed"), coordinator)).toBe(
      false
    )
    expect(isHarnessPlumbing(call("ToolSearch", "completed"), workspace)).toBe(
      false
    )
    expect(
      isHarnessPlumbing(
        call("mcp__screenplay__read_canvas", "completed"),
        coordinator
      )
    ).toBe(false)
  })

  it("is Codex's Guardian Review in every chat, unless it failed", () => {
    const byId = (status: "in_progress" | "completed" | "failed") =>
      call("Reviewing approval request", status, "guardian_assessment:r1")
    for (const where of [coordinator, workspace]) {
      expect(isHarnessPlumbing(byId("completed"), where)).toBe(true)
      expect(isHarnessPlumbing(byId("in_progress"), where)).toBe(true)
      expect(
        isHarnessPlumbing(call("Guardian Review", "completed"), where)
      ).toBe(true)
      expect(isHarnessPlumbing(byId("failed"), where)).toBe(false)
      expect(isHarnessPlumbing(call("Guardian Review", "failed"), where)).toBe(
        false
      )
    }
  })

  it("never hides a thinking step for its kind alone", () => {
    expect(
      isHarnessPlumbing(
        { ...call("Thinking", "completed"), kind: "think" as const },
        workspace
      )
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
