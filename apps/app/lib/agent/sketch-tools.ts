import "server-only"

import { jsonSchema, tool } from "ai"

import { annotateTools } from "@/lib/mcp/tool-server"
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
 * A Sketch Chat's own `read_skill` (`lib/chat/sketch-chat.ts`), for the
 * Mockup App Skills only. The Sketch Chat Target lists it beside the Document,
 * Mockup and Frame Drive tools (`sketch-chat-target.ts`).
 */
export function buildSketchSkillTools() {
  const listing = sketchSkillIndex()
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n")
  const tools = {
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
  // Reading a Skill changes nothing.
  return annotateTools(tools, {
    read_skill: { readOnlyHint: true, openWorldHint: false },
  })
}
