import type { AgentMessage } from "@/lib/agent/types"

/**
 * A tool call's own name, without the namespace a desktop harness adds when
 * it reaches our tools over MCP (#903): Claude Code reports
 * `mcp__screenplay__read_canvas` and Codex `Tool: screenplay/read_canvas`,
 * where the in-process engine reports `read_canvas`. Any other title comes
 * back as is.
 */
export function bareToolName(title: string): string {
  const claude = title.match(/^mcp__[^_]+(?:_[^_]+)*__([a-z][a-z0-9_]*)$/)
  if (claude) return claude[1]!
  const codex = title.match(/^Tool: [^/\s]+\/([a-z][a-z0-9_]*)$/)
  if (codex) return codex[1]!
  return title
}

/**
 * Claude Code's own step for loading deferred tools (our MCP tools among
 * them) before it calls them. It says nothing about the work, so the
 * Coordinator's chat leaves it out unless it failed.
 */
const HARNESS_PLUMBING = new Set(["ToolSearch"])

/** Whether a tool call is harness plumbing the Coordinator's chat hides. */
export function isHarnessPlumbing(message: AgentMessage): boolean {
  return (
    message.role === "tool_call" &&
    HARNESS_PLUMBING.has(message.title) &&
    message.status !== "failed"
  )
}
