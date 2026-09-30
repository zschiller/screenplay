import "server-only"

import type { Tool, ToolSet } from "ai"

import { redactSensitiveInfo } from "@/lib/agent/redact"
import { buildSandboxTools, type ToolContext } from "@/lib/agent/tools"
import { buildDocumentTools } from "@/lib/agent/document-tools"
import { buildLayerReadTools } from "@/lib/agent/layer-read-tools"
import { buildQuestionTools } from "@/lib/agent/question-tools"
import type { RoomDoc } from "@/lib/room-access"
import { buildRoomTools, type RoomToolPorts } from "@/lib/agent/room-tools"

/**
 * What a chat target needs to assemble its toolset. The sandbox kind carries a
 * {@link ToolContext} (which VM, room, acting user) and its chat, which owns
 * the Documents it makes (#1314); the room kind carries the ports the
 * Coordinator tools module drives. All carry the turn's Room (from Room
 * Access) so the cross-cutting read tools can resolve peer layers.
 */
export type ToolTarget =
  | { kind: "sandbox"; room: RoomDoc; sandbox: ToolContext; chatId: string }
  | {
      kind: "room"
      room: RoomDoc
      ports: RoomToolPorts
      /** The turn the tools' canvas changes are logged under (a new one by default). */
      turnId?: string
    }

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
  const read = buildLayerReadTools({ room: target.room })
  const ask = buildQuestionTools()
  const own =
    target.kind === "sandbox"
      ? {
          ...buildSandboxTools(target.sandbox),
          ...buildDocumentTools({ room: target.room, chatId: target.chatId }),
        }
      : buildRoomTools(target.room.roomId, target.ports, target.turnId)
  return withRedactedOutput({ ...own, ...read, ...ask })
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
