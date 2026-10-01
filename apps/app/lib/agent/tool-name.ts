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
 * How a system prompt names Screenplay's own tools for the engine a turn runs
 * on (#1223). The in-process engine calls them by their bare names. A desktop
 * harness reaches them over our MCP server under its own namespace, and a
 * prompt that names the bare `read_skill` sends Claude Code looking for a tool
 * it doesn't have, so its first call fails.
 */
export interface ToolNaming {
  /** The name the model calls a Screenplay tool by. */
  name(tool: string): string
  /**
   * A line for the prompt when the harness's names can't be rendered exactly:
   * it says which MCP server the named tools come from.
   */
  note?: string
}

/** The in-process engine's naming: every tool by its bare name. */
export const BARE_TOOL_NAMING: ToolNaming = { name: (tool) => tool }

/**
 * The naming for a harness that reaches our tools as the MCP server `server`.
 * Claude Code's names are fixed (`mcp__<server>__<tool>`, the form
 * {@link bareToolName} strips), so its prompt names them exactly. Other
 * harnesses namespace MCP tools in ways that vary by version (Codex's
 * `screenplay/<tool>` titles aren't what its model calls), so their prompt
 * keeps the bare names and says where they come from.
 */
export function harnessToolNaming(
  harnessKey: string,
  server: string
): ToolNaming {
  if (harnessKey === "claude-code") {
    return { name: (tool) => `mcp__${server}__${tool}` }
  }
  return {
    name: (tool) => tool,
    note: `Screenplay's own tools named in these instructions come from the MCP server \`${server}\`, so they may be listed under that server's namespace rather than by the bare names below.`,
  }
}

/**
 * Claude Code's own step for loading deferred tools (our MCP tools among
 * them) before it calls them. It says nothing about the work, so the
 * Coordinator's chat leaves it out unless it failed. A Workspace's chat keeps
 * it.
 */
const COORDINATOR_PLUMBING = new Set(["ToolSearch"])

/**
 * Codex's automatic approval reviewer ("Guardian Review"), which codex-acp
 * reports as a tool call next to the call it reviewed, with a
 * `guardian_assessment:` id. Matched by id or title, never by its
 * `kind: "think"` alone, which real thinking steps share.
 */
function isGuardianReview(message: AgentMessage & { role: "tool_call" }) {
  return (
    message.toolCallId.startsWith("guardian_assessment:") ||
    message.title === "Guardian Review"
  )
}

/**
 * Whether a tool call is harness plumbing a chat hides: a Guardian Review in
 * every chat, and Claude Code's tool loading in the Coordinator's. One that
 * failed always shows, since it explains why something didn't run.
 */
export function isHarnessPlumbing(
  message: AgentMessage,
  { coordinator }: { coordinator: boolean }
): boolean {
  if (message.role !== "tool_call" || message.status === "failed") return false
  return (
    isGuardianReview(message) ||
    (coordinator && COORDINATOR_PLUMBING.has(message.title))
  )
}
