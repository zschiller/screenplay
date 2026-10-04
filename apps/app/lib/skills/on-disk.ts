import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"

import type { ContextSection } from "@/lib/files/context-folder"

import type { AppSkills } from "./index"
import type { SavedSkills, SkillFile } from "./saved"

/**
 * Saved Skills on disk for coding agents (#1559, spec #1554): the canvas's
 * and the sender's Account Skills, written into the chat's context folder
 * (#1524) before each turn as real Skill folders, so the harness loads them
 * natively, with its own `/name` or `$name` invocation and the files a Skill
 * keeps beside its `SKILL.md`.
 *
 * The context folder rides ACP `additionalDirectories`, and each harness
 * looks for Skills in its own subfolder of it: Claude Code reads
 * `.claude/skills/`, Codex `.agents/skills/` (research #1528), and OpenCode
 * the same `.agents/skills/` through its config's `skills.paths` (#1589,
 * `opencodeDirectoriesEnv`). So the same
 * Skills are written as two sections. Both hold one merged set: a canvas
 * Skill wins over an account Skill of the same name, either over the App
 * Skill of that name (written with its supporting files, #1642), and a name
 * the repository's own Skills already use is left out, the harness reading
 * those from the checkout (spec #1554's order: repo, canvas, account, app).
 */

/** The context folder sections that hold Skills, by the harness reading each. */
export const CLAUDE_SKILLS_SECTION = ".claude"
export const AGENTS_SKILLS_SECTION = ".agents"

/** A Skill as written to disk: its `SKILL.md` and supporting files. */
interface SkillOnDisk {
  name: string
  content: string
  files: SkillFile[]
}

/** Where a turn's Skills on disk come from. */
interface SkillSources {
  canvas: SavedSkills
  account: SavedSkills | null
  /** The App Skills the chat sees. */
  app?: AppSkills
  shadowed?: () => Promise<Iterable<string>>
}

/**
 * The Skill sections of a turn's context folder: the canvas's Skills, the
 * sender's (`null` on a turn nobody sent) and the App Skills the chat sees,
 * less any name in `shadowed` (the Branch's Repo Skills). Both sections share
 * one read of the Skills.
 */
export function savedSkillSections(
  sources: SkillSources
): Record<string, ContextSection> {
  let loaded: Promise<SkillOnDisk[]> | undefined
  const skills = () => (loaded ??= skillsOnDisk(sources))
  const section: ContextSection = async (dir) =>
    writeSkills(join(dir, "skills"), await skills())
  return {
    [CLAUDE_SKILLS_SECTION]: section,
    [AGENTS_SKILLS_SECTION]: section,
  }
}

async function skillsOnDisk(sources: SkillSources): Promise<SkillOnDisk[]> {
  const taken = new Set(sources.shadowed ? await sources.shadowed() : [])
  const out: SkillOnDisk[] = []
  for (const scope of [sources.canvas, sources.account]) {
    if (!scope) continue
    for (const skill of await scope.list()) {
      if (taken.has(skill.name)) continue
      taken.add(skill.name)
      const read = await scope.read(skill.name)
      if (read.ok) {
        out.push({
          name: skill.name,
          content: read.value.content,
          files: read.value.files,
        })
      }
    }
  }
  for (const { name } of sources.app?.index() ?? []) {
    if (taken.has(name)) continue
    const opened = sources.app?.open(name)
    if (opened) out.push({ name, ...opened })
  }
  return out
}

/**
 * Write `skills` into `dir`, one folder each, replacing whatever was there:
 * a deleted Skill, or a file a Skill no longer has, is gone. The folder is
 * rewritten whole each turn; Skills are small.
 */
async function writeSkills(dir: string, skills: SkillOnDisk[]): Promise<void> {
  const root = resolve(dir)
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  for (const skill of skills) {
    const folder = join(root, skill.name)
    const files = [{ path: "SKILL.md", content: skill.content }, ...skill.files]
    for (const file of files) {
      const full = resolve(folder, file.path)
      // Saved paths are normalized already; never let one climb out.
      if (!full.startsWith(folder + sep)) continue
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, file.content)
    }
  }
}
