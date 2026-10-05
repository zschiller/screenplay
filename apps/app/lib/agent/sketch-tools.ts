import "server-only"

import {
  getSkill,
  getSkillIndex,
  openSkill,
  type AppSkills,
} from "@/lib/skills"

/**
 * The App Skills a Sketch Chat can read: the ones about the pages it writes
 * (knobs and shared state on a Mockup). Every other App Skill builds code in a
 * sandbox, which a Sketch Chat doesn't have.
 */
const SKETCH_SKILLS = new Set(["screenplay-add-knob", "screenplay-share-state"])

/**
 * A Sketch Chat's App Skills, for its Skill Sources (`sketch-chat-target.ts`):
 * the Mockup ones only.
 */
export const sketchAppSkills: AppSkills = {
  index: () => getSkillIndex().filter((s) => SKETCH_SKILLS.has(s.name)),
  read: (name) => (SKETCH_SKILLS.has(name) ? getSkill(name) : null),
  open: (name) => (SKETCH_SKILLS.has(name) ? openSkill(name) : null),
}
