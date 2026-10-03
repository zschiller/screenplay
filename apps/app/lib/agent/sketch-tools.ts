import "server-only"

import { jsonSchema, tool, type ToolSet } from "ai"

import { buildDocumentTools } from "@/lib/agent/document-tools"
import { buildMockupTools } from "@/lib/agent/mockup-tools"
import { chatFrameDriveTools } from "@/lib/frame-drive/live"
import type { McpToolAnnotations } from "@/lib/mcp/tool-server"
import type { RoomDoc } from "@/lib/room-access"
import { getSkill, getSkillIndex } from "@/lib/skills"
import type { SkillMetadata } from "@/lib/skills/frontmatter"

/**
 * The App Skills a Sketch Chat can read: the ones about the pages it writes
 * (knobs and shared state on a Mockup). Every other App Skill builds code in a
 * sandbox, which a Sketch Chat doesn't have.
 */
const SKETCH_SKILLS = new Set(["screenplay-add-knob", "screenplay-share-state"])

/** The Sketch Chat's App Skill index, for its prompt. */
export function sketchSkillIndex(): SkillMetadata[] {
  return getSkillIndex().filter((s) => SKETCH_SKILLS.has(s.name))
}

/**
 * A Sketch Chat's own tools (`lib/chat/sketch-chat.ts`): the Document and
 * Mockup tools every chat has, owned by this chat, Frame Drive to drive a
 * Mockup in the asker's view (#1391), and `read_skill` for the Mockup App
 * Skills. No sandbox, so nothing that touches code.
 */
export function buildSketchTools({
  room,
  chatId,
  userId,
}: {
  room: RoomDoc
  chatId: string
  /** The asker, in whose view the chat drives a Mockup (#1391). */
  userId: string
}): ToolSet {
  const listing = sketchSkillIndex()
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n")
  return {
    ...buildDocumentTools({ room, chatId }),
    ...buildMockupTools({ room, chatId }),
    ...chatFrameDriveTools({ room, userId }),
    read_skill: tool({
      description: `Load the full instructions for one of your skills. Skills:\n${listing}`,
      inputSchema: jsonSchema<{ name: string }>({
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      }),
      execute: async ({ name }) =>
        (SKETCH_SKILLS.has(name) ? getSkill(name) : null) ??
        `Unknown skill: "${name}". Available skills:\n${listing}`,
    }),
  }
}

/**
 * MCP annotations for {@link buildSketchTools}' own tools and the layer read
 * every chat gets (`layer-read-tools.ts`).
 */
export const SKETCH_TOOL_ANNOTATIONS: Readonly<
  Record<string, McpToolAnnotations>
> = {
  read_skill: { readOnlyHint: true, openWorldHint: false },
  read_document: { readOnlyHint: true, openWorldHint: false },
}
