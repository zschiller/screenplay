import type { SandboxInstance } from "@/lib/sandbox/types"

import { parseFrontmatter } from "./frontmatter"
import type { OriginTaggedSkill } from "./merged"

/**
 * Repo Skills are Skills a Branch carries in its own checked-out repo at
 * `.claude/skills/<name>/SKILL.md`, discovered in that Branch's sandbox at
 * chat init. Unlike App Skills (bundled in `lib/skills/`, branch-independent),
 * they vary per branch and let a repo owner ship — or override — Skills from
 * the working tree.
 *
 * The enumerator is pure given a {@link RepoSkillFs}: a narrow two-method port
 * over "list a directory" + "read a file". The real port is backed by the
 * sandbox ({@link sandboxRepoSkillFs}); tests hand it an in-memory fake. This
 * keeps the discovery rules — which entries count, the dir-name invariant,
 * absent-dir handling — testable without a live VM.
 */

const SKILLS_DIR = ".claude/skills"

/**
 * The filesystem surface the enumerator needs. Both methods are scoped to the
 * Branch's working tree.
 */
export interface RepoSkillFs {
  /**
   * Entry names directly under `dirPath` (files and directories alike).
   * Returns `null` when the directory does not exist — the signal the
   * enumerator turns into an empty Skill list rather than an error.
   */
  list(dirPath: string): Promise<string[] | null>
  /** Read a UTF-8 file; `null` when it doesn't exist (or isn't a file). */
  read(filePath: string): Promise<string | null>
}

/**
 * Discover Repo Skills under `.claude/skills/`. For each entry, attempts to
 * read `<entry>/SKILL.md`: a non-directory (or a directory without a
 * `SKILL.md`) yields no file and is skipped, so the "skip non-directories /
 * dirs without SKILL.md" rule falls out of the read returning `null`. Enforces
 * the same directory-name-equals-`name` invariant the App loader does — a
 * mismatch throws. An absent `.claude/skills/` yields an empty list.
 */
export async function enumerateRepoSkills(
  fs: RepoSkillFs,
): Promise<OriginTaggedSkill[]> {
  const entries = await fs.list(SKILLS_DIR)
  if (!entries) return []

  const out: OriginTaggedSkill[] = []
  for (const entry of entries) {
    const skillMd = `${SKILLS_DIR}/${entry}/SKILL.md`
    const raw = await fs.read(skillMd)
    if (raw === null) continue
    const { metadata } = parseFrontmatter(raw, skillMd)
    if (metadata.name !== entry) {
      throw new Error(
        `Repo Skill at ${skillMd} declares name="${metadata.name}" but lives in directory "${entry}". Names must match.`,
      )
    }
    out.push({ ...metadata, origin: "repo" })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Read a single Repo Skill's full content (frontmatter + body) by name, the
 * sandbox-first half of the merged body resolver. Returns `null` when the
 * Branch has no Repo Skill of that name, so the resolver can fall back to the
 * App Skill of the same name.
 */
export async function readRepoSkillBody(
  fs: RepoSkillFs,
  name: string,
): Promise<string | null> {
  return fs.read(`${SKILLS_DIR}/${name}/SKILL.md`)
}

/**
 * Back a {@link RepoSkillFs} with a live sandbox instance. `list` shells `ls`
 * (a non-zero exit — missing dir — maps to `null`); `read` goes through the
 * sandbox's buffer read. This is the only adapter that touches a VM; the
 * enumerator itself stays pure.
 */
export function sandboxRepoSkillFs(sandbox: SandboxInstance): RepoSkillFs {
  return {
    async list(dirPath) {
      const result = await sandbox.runCommand("ls", ["-1", dirPath])
      if (result.exitCode !== 0) return null
      const stdout = await result.stdout()
      return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    },
    async read(filePath) {
      const buf = await sandbox.readFileToBuffer({ path: filePath })
      return buf ? buf.toString("utf-8") : null
    },
  }
}
