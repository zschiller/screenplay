import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

import {
  parseFrontmatter,
  type SkillAudience,
  type SkillMetadata,
} from "./frontmatter"
import { renderSkill, type OpenedSkill, type SkillFile } from "./saved"

export type { SkillAudience, SkillMetadata }

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
 * A Skill's `audience` frontmatter says which chat it is for: Workspace agents
 * by default, or the Coordinator (`audience: coordinator`), whose prompt and
 * `read_skill` tool see only its own Skills. Every lookup here takes the
 * audience and defaults to Workspace agents.
 *
 * A Skill folder may also hold supporting files beside its `SKILL.md`, like a
 * page template (#1642). They load with it: `read_skill` shows them, the
 * harness context folder writes them (`sources.ts`), and a saved copy of the
 * Skill keeps the ones it doesn't replace ({@link AppSkillSet.carryFiles}).
 *
 * To add a skill: drop a `lib/skills/<name>/SKILL.md` with frontmatter. No
 * registration code needed.
 */

/** The App Skills a kind of chat sees, as a Skill source. */
export interface AppSkills {
  index(): SkillMetadata[]
  /** The Skill as `read_skill` shows it, files included. */
  read(name: string): string | null
  /** The Skill as written to disk, for a harness (`sources.ts`). */
  open(name: string): OpenedSkill | null
}

/** The App Skills in one folder, every audience's. */
export interface AppSkillSet {
  index(audience?: SkillAudience): SkillMetadata[]
  read(name: string, audience?: SkillAudience): string | null
  open(name: string, audience?: SkillAudience): OpenedSkill | null
  has(name: string, audience?: SkillAudience): boolean
  /** The App Skills `audience` sees, as a Skill source for the Skill tools. */
  source(audience?: SkillAudience): AppSkills
  /**
   * `files` for saving a Skill named `name`, plus the supporting files of
   * the App Skill of that name (for any audience) that `files` doesn't
   * replace, and the paths it added. So a saved copy of an App Skill, which
   * takes its place, keeps its templates without the agent passing them back
   * (#1642).
   */
  carryFiles(
    name: string,
    files?: readonly SkillFile[]
  ): { files: SkillFile[]; carried: string[] }
}

interface LoadedSkill {
  metadata: SkillMetadata
  body: string
  audience: SkillAudience
  /** The whole `SKILL.md`, as on disk. */
  raw: string
  /** Its supporting files, by path inside its folder. */
  files: SkillFile[]
}

/** Load the App Skills in `dir`, one folder each. */
export function loadAppSkills(dir: string): AppSkillSet {
  const skills = loadAllSkills(dir)
  const find = (name: string, audience: SkillAudience = "workspace") => {
    const skill = skills.get(name)
    return skill?.audience === audience ? skill : null
  }
  const set: AppSkillSet = {
    index: (audience = "workspace") =>
      Array.from(skills.values())
        .filter((s) => s.audience === audience)
        .map((s) => s.metadata)
        .sort((a, b) => a.name.localeCompare(b.name)),
    read(name, audience) {
      const skill = find(name, audience)
      if (!skill) return null
      // Re-emit frontmatter alongside the body so the agent sees its own
      // declared name/description in the tool result, not just the body.
      return renderSkill(
        `---\nname: ${skill.metadata.name}\ndescription: ${skill.metadata.description}\n---\n\n${skill.body}`,
        skill.files
      )
    },
    open(name, audience) {
      const skill = find(name, audience)
      return skill ? { content: skill.raw, files: skill.files } : null
    },
    has: (name, audience) => !!find(name, audience),
    source: (audience = "workspace") => ({
      index: () => set.index(audience),
      read: (name) => set.read(name, audience),
      open: (name) => set.open(name, audience),
    }),
    carryFiles(name, files = []) {
      const given = new Set(files.map((f) => f.path))
      const carried = (skills.get(name)?.files ?? []).filter(
        (f) => !given.has(f.path)
      )
      return {
        files: [...files, ...carried],
        carried: carried.map((f) => f.path),
      }
    },
  }
  return set
}

function loadAllSkills(dir: string): Map<string, LoadedSkill> {
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
        `Skill at ${skillDir} declares name="${skill.metadata.name}" but lives in directory "${entry}". Names must match.`
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
  const files = listFiles(skillDir)
    .map((full) => relative(skillDir, full).split(sep).join("/"))
    .filter((path) => path !== "SKILL.md")
    .sort()
    .map((path) => ({
      path,
      content: readFileSync(join(skillDir, path), "utf8"),
    }))
  return { ...parseFrontmatter(raw, skillMd), raw, files }
}

/** Every file under `dir`, at any depth. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return listFiles(full)
    return entry.isFile() ? [full] : []
  })
}

/** Screenplay's own App Skills, bundled in `lib/skills/`. */
export const appSkills = loadAppSkills(join(process.cwd(), "lib", "skills"))

export const getSkillIndex = (
  audience: SkillAudience = "workspace"
): SkillMetadata[] => appSkills.index(audience)

export const getSkill = (
  name: string,
  audience: SkillAudience = "workspace"
): string | null => appSkills.read(name, audience)

/** An App Skill as written to disk: its whole `SKILL.md` and its files. */
export const openSkill = (
  name: string,
  audience: SkillAudience = "workspace"
): OpenedSkill | null => appSkills.open(name, audience)

export const hasSkill = (
  name: string,
  audience: SkillAudience = "workspace"
): boolean => appSkills.has(name, audience)

/** The App Skills `audience` sees, as a Skill source for the Skill tools. */
export const appSkillSource = (
  audience: SkillAudience = "workspace"
): AppSkills => appSkills.source(audience)
