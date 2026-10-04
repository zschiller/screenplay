import "server-only"

import { getSkill, getSkillIndex, openSkill } from "@/lib/skills"
import type { SkillMetadata } from "@/lib/skills/frontmatter"
import type { SkillToolContext } from "./skill-tools"

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
 * A Sketch Chat's App Skills for its Skill tools (`skill-tools.ts`): the
 * Mockup ones only.
 */
export const sketchAppSkills: SkillToolContext["app"] = {
  index: sketchSkillIndex,
  read: (name) => (SKETCH_SKILLS.has(name) ? getSkill(name) : null),
  open: (name) => (SKETCH_SKILLS.has(name) ? openSkill(name) : null),
}
