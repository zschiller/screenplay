import "server-only"

import type { Tool, ToolSet } from "ai"

import { redactDeep, redactSensitiveInfo } from "@/lib/agent/redact"
import {
  BARE_TOOL_NAMING,
  namingWithin,
  type ToolNaming,
} from "@/lib/agent/tool-name"

/**
 * A Chat Target kind's tools, listed once by the kind (#1487). `shared` reach
 * every Engine: the in-process engine runs them, and the agent MCP route
 * serves them to a desktop harness, each with the MCP annotations it carries.
 * `native` are the in-process engine's own file, shell and plan tools, which
 * a harness brings its own of.
 */
export interface ChatTools {
  shared: ToolSet
  native?: ToolSet
}

/** Where a turn runs: the in-process engine, or a desktop harness over MCP. */
export type ToolEngine = "in-process" | "harness"

/**
 * The toolset a Chat Target's turn has on `engine`: its shared tools, plus
 * its native ones in process. Wrapped in {@link withRedactedOutput} so no
 * tool can spill a secret regardless of which one produced the output.
 */
export function toolsetOn(tools: ChatTools, engine: ToolEngine): ToolSet {
  return withRedactedOutput(
    engine === "harness" ? tools.shared : { ...tools.native, ...tools.shared }
  )
}

/**
 * A turn's toolset on the Engine `naming` is for, and that naming limited to
 * it, so the prompt built with it can only tell the model to call a tool the
 * turn has.
 */
export function turnToolset(
  tools: ChatTools,
  naming: ToolNaming = BARE_TOOL_NAMING
): { tools: ToolSet; naming: ToolNaming } {
  const toolset = toolsetOn(tools, naming.harness ? "harness" : "in-process")
  return { tools: toolset, naming: namingWithin(naming, Object.keys(toolset)) }
}

/**
 * Wraps every tool's `execute` so its (string) output passes through
 * `redactSensitiveInfo` before it leaves the trusted server layer for the chat
 * UI, a Liveblocks broadcast, or the Anthropic session history. This is the
 * one place output redaction lives — closing the leak structurally instead of
 * relying on each tool to remember.
 *
 * `secrets` are the Workspace's env var values (from `secretPatterns`, #1416):
 * stripped from string output and from every string inside structured output,
 * so the model never sees them and can't repeat them in a reply, commit or PR.
 *
 * Tools with no `execute` (human-in-the-loop, e.g. `submit_plan`) pass through
 * untouched.
 */
export function withRedactedOutput(
  tools: ToolSet,
  secrets: readonly string[] = []
): ToolSet {
  const wrapped: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    wrapped[name] = redactToolOutput(t, secrets)
  }
  return wrapped
}

function redactToolOutput(tool: Tool, secrets: readonly string[]): Tool {
  const execute = tool.execute
  if (typeof execute !== "function") return tool
  return {
    ...tool,
    execute: (async (input: unknown, options: unknown) => {
      const output = await execute(input as never, options as never)
      if (typeof output === "string") {
        return redactSensitiveInfo(output, secrets)
      }
      return secrets.length > 0 ? redactDeep(output, secrets) : output
    }) as Tool["execute"],
  }
}
