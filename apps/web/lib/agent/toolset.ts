import "server-only"

import type { Tool, ToolSet } from "ai"

import { redactSensitiveInfo } from "@/lib/agent/redact"
import { buildSandboxTools, type ToolContext } from "@/lib/agent/tools"
import { buildMarkdownLayerTools } from "@/lib/agent/markdown-layer-tools"
import { buildLayerReadTools } from "@/lib/agent/layer-read-tools"

/**
 * What a chat target needs to assemble its toolset. The sandbox kind carries a
 * {@link ToolContext} (which VM, room, acting user); the markdown-layer kind
 * carries the document it's editing. Both carry `roomId` so the cross-cutting
 * read tools can resolve peer layers.
 */
export type ToolTarget =
  | { kind: "sandbox"; roomId: string; sandbox: ToolContext }
  | { kind: "markdown-layer"; roomId: string; markdownLayerId: string }

/**
 * The single assembly point for an agent loop's tools. Picks the target's own
 * write tools, mixes in the cross-cutting read tools every chat shares, and
 * wraps the whole set in {@link withRedactedOutput} so no tool can spill a
 * secret regardless of which one produced the output.
 *
 * Adding a new chat target kind is one new case here; adding a new tool is one
 * edit to a builder.
 */
export function toolsetFor(target: ToolTarget): ToolSet {
  const read = buildLayerReadTools({ roomId: target.roomId })
  const own =
    target.kind === "sandbox"
      ? buildSandboxTools(target.sandbox)
      : buildMarkdownLayerTools({
          roomId: target.roomId,
          markdownLayerId: target.markdownLayerId,
        })
  return withRedactedOutput({ ...own, ...read })
}

/**
 * Wraps every tool's `execute` so its (string) output passes through
 * `redactSensitiveInfo` before it leaves the trusted server layer for the chat
 * UI, a Liveblocks broadcast, or the Anthropic session history. This is the
 * one place output redaction lives — closing the leak structurally instead of
 * relying on each tool to remember.
 *
 * Tools with no `execute` (human-in-the-loop, e.g. `submit_plan`) pass through
 * untouched.
 */
export function withRedactedOutput(tools: ToolSet): ToolSet {
  const wrapped: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    wrapped[name] = redactToolOutput(t)
  }
  return wrapped
}

function redactToolOutput(tool: Tool): Tool {
  const execute = tool.execute
  if (typeof execute !== "function") return tool
  return {
    ...tool,
    execute: (async (input: unknown, options: unknown) => {
      const output = await execute(input as never, options as never)
      return typeof output === "string" ? redactSensitiveInfo(output) : output
    }) as Tool["execute"],
  }
}
