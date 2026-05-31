import { readFileSync, readdirSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

import { parseFrontmatter, type SkillMetadata } from "./frontmatter"

export type { SkillMetadata }

/**
 * Skills are markdown documents that teach the agent how to use a particular
 * screenplay-side feature. Each lives at `lib/skills/<name>/SKILL.md` and
 * starts with YAML-style frontmatter declaring its name + description:
 *
 *   ---
 *   name: knobs
 *   description: Add interactive controls that ...
 *   ---
 *
 * `getSkillIndex()` returns the metadata for every skill on disk; the agent's
 * system prompt injects this list at create time so Claude discovers skills
 * the same way it would with native Anthropic-managed skills. `getSkill(name)`
 * returns the full body, served to the agent via the `read_skill` custom tool
 * when it decides a skill is relevant.
 *
 * To add a skill: drop a `lib/skills/<name>/SKILL.md` with frontmatter. No
 * registration code needed.
 */

const dir = join(process.cwd(), "lib", "skills")

interface LoadedSkill {
  metadata: SkillMetadata
  body: string
  /** Raw on-disk content — used for cache-busting the agent when skills change. */
  rawSource: string
}

const skills = loadAllSkills()

function loadAllSkills(): Map<string, LoadedSkill> {
  const out = new Map<string, LoadedSkill>()
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }

  for (const entry of entries) {
    const skillDir = join(dir, entry)
    let stat
    try {
      stat = statSync(skillDir)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue
    const skill = loadSkillFromDir(skillDir)
    if (!skill) continue
    if (skill.metadata.name !== entry) {
      throw new Error(
        `Skill at ${skillDir} declares name="${skill.metadata.name}" but lives in directory "${entry}". Names must match.`,
      )
    }
    out.set(skill.metadata.name, skill)
  }
  return out
}

function loadSkillFromDir(skillDir: string): LoadedSkill | null {
  const skillMd = join(skillDir, "SKILL.md")
  let raw: string
  try {
    raw = readFileSync(skillMd, "utf8")
  } catch {
    return null
  }
  const { metadata, body } = parseFrontmatter(raw, skillMd)
  return { metadata, body, rawSource: raw }
}

export function getSkillIndex(): SkillMetadata[] {
  return Array.from(skills.values())
    .map((s) => s.metadata)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function getSkill(name: string): string | null {
  const skill = skills.get(name)
  if (!skill) return null
  // Re-emit frontmatter alongside the body so the agent sees its own
  // declared name/description in the tool result, not just the body.
  return `---\nname: ${skill.metadata.name}\ndescription: ${skill.metadata.description}\n---\n\n${skill.body}`
}

export function hasSkill(name: string): boolean {
  return skills.has(name)
}

/**
 * Stable hash over every skill's source. Mixed into the agent cache key so
 * editing a SKILL.md rolls a fresh agent on next deploy without needing a
 * manual version bump.
 */
export const SKILLS_HASH: string = (() => {
  const hash = createHash("sha256")
  const names = Array.from(skills.keys()).sort()
  for (const name of names) {
    hash.update(name)
    hash.update("\0")
    const skill = skills.get(name)
    if (skill) hash.update(skill.rawSource)
  }
  return hash.digest("hex").slice(0, 12)
})()
