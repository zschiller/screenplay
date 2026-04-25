import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Skills are markdown files that teach the agent how to use a particular
 * screenplay-side feature. They're loaded from disk at module-init time,
 * stitched together with whatever helper-file source they reference, and
 * served to the agent via the `read_skill` tool.
 *
 * To add a new skill:
 *  1. Create `lib/skills/<name>/SKILL.md`.
 *  2. (Optional) Drop helper source files alongside it; reference them
 *     from the markdown using `{{HELPER_SOURCE}}` etc. and wire up the
 *     substitution below.
 *  3. Add the name to `SKILL_NAMES` and `loadSkill`.
 */

const dir = join(process.cwd(), "lib", "skills")

function loadFile(name: string, file: string): string {
  return readFileSync(join(dir, name, file), "utf8")
}

function loadKnobsSkill(): string {
  const md = loadFile("knobs", "SKILL.md")
  const helper = loadFile("knobs", "helper.tsx")
  return md.replace("{{HELPER_SOURCE}}", helper)
}

const SKILLS: Record<string, () => string> = {
  knobs: loadKnobsSkill,
}

export const SKILL_NAMES = Object.keys(SKILLS)

const cache = new Map<string, string>()

export function getSkill(name: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(SKILLS, name)) return null
  const cached = cache.get(name)
  if (cached) return cached
  const loader = SKILLS[name]
  if (!loader) return null
  const content = loader()
  cache.set(name, content)
  return content
}
