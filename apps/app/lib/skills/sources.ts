import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"

import type { ContextSection } from "@/lib/files/context-folder"

import type { AgentSkills } from "./agent-skills"
import type { SkillMetadata } from "./frontmatter"
import type { AppSkills } from "./index"
import {
  enumerateRepoSkills,
  readRepoSkillFile,
  type RepoSkillFs,
} from "./repo-skills"
import { renderSkill, type OpenedSkill, type SavedSkills } from "./saved"

/**
 * **Skill Sources** (#1664): every Skill one chat sees, as one value its Chat
 * Target builds once per turn. The prompt's index, `read_skill`, the
 * harness's context folder and a Mockup page's `skill:` references all read
 * it, so they resolve the same Skill for the same chat.
 *
 * A chat's Skills come from up to five sources: Repo Skills (its Branch's
 * `.claude/skills/`, Workspace chats only), Canvas Skills (saved by any chat
 * on the canvas, `canvas.ts`), Account Skills (saved to the person who sent
 * the turn, `account.ts`), the desktop agent's own (`agent-skills.ts`) and
 * the App Skills its kind of chat sees (bundled `lib/skills/`). The rule,
 * stated once here as {@link SKILL_ORIGIN_RANK}: **Repo, then Canvas, then
 * Account, then the agent's own, then App** (spec #1554). The first source
 * that has a name answers for it whole: its row in the index, its body and
 * its files.
 *
 * On disk, the context folder holds the winning Skill of each name the
 * harness doesn't load itself: it reads Repo Skills from the checkout and its
 * own from the user's home, so those names are left out.
 */

export type SkillOrigin = "repo" | "canvas" | "account" | "agent" | "app"

/** Which source wins a name collision, first to last. */
export const SKILL_ORIGIN_RANK: readonly SkillOrigin[] = [
  "repo",
  "canvas",
  "account",
  "agent",
  "app",
]

export interface OriginTaggedSkill extends SkillMetadata {
  origin: SkillOrigin
}

/** Where a chat's Skills come from; a source the chat doesn't have is left out. */
export interface SkillSourceInputs {
  /**
   * The Branch's Repo Skills, on a Workspace chat; resolves `null` when its
   * sandbox can't be reached.
   */
  repo?: () => Promise<RepoSkillFs | null>
  /** The canvas's saved Skills. */
  canvas?: SavedSkills | null
  /** The turn sender's Account Skills; `null` on a turn nobody sent. */
  account?: SavedSkills | null
  /** The desktop coding agent's own Skills (#1560). */
  agent?: AgentSkills | null
  /** The App Skills this kind of chat sees. */
  app: AppSkills
}

export interface SkillSources {
  /** The merged index: one row per name, from the source that wins it. */
  index(): Promise<OriginTaggedSkill[]>
  /** A Skill as `read_skill` shows it, files included; `null` when none. */
  read(name: string): Promise<string | null>
  /**
   * A file of the winning Skill of `name`, by path inside its folder
   * (`SKILL.md` included); `null` when no source has the Skill or it has no
   * such file.
   */
  file(name: string, path: string): Promise<string | null>
  /** The sources that have a Skill named `name`, winner first. */
  holders(name: string): Promise<SkillOrigin[]>
  /** The context folder sections that hold the Skills, by harness. */
  contextSections(): Record<string, ContextSection>
  /** The App Skills this chat sees, for text built before any turn. */
  appIndex(): SkillMetadata[]
}

/** The context folder sections that hold Skills, by the harness reading each. */
export const CLAUDE_SKILLS_SECTION = ".claude"
export const AGENTS_SKILLS_SECTION = ".agents"
/**
 * Where in the context folder Codex and OpenCode find Skills: Claude Code
 * reads `.claude/skills/`, Codex `.agents/skills/` (research #1528), and
 * OpenCode the same through its config's `skills.paths` (#1589).
 */
export const AGENTS_SKILLS_DIR = `${AGENTS_SKILLS_SECTION}/skills`

/** One source, read the same way whichever it is. */
interface Source {
  index(): Promise<readonly SkillMetadata[]>
  read(name: string): Promise<string | null>
  /** `undefined` when the source has no Skill of that name. */
  file(name: string, path: string): Promise<string | null | undefined>
  /** The whole Skill, for disk; absent on a source the harness loads itself. */
  open?(name: string): Promise<OpenedSkill | null>
}

export function skillSources(inputs: SkillSourceInputs): SkillSources {
  const sources = sourcesOf(inputs)
  const ranked = SKILL_ORIGIN_RANK.flatMap((origin) => {
    const source = sources[origin]
    return source ? [{ origin, source }] : []
  })

  const index = async () => {
    const lists = await Promise.all(
      ranked.map(({ source }) => source.index().catch(() => []))
    )
    return mergeIndexes(
      ranked.map(({ origin }, i) => ({ origin, skills: lists[i]! }))
    )
  }

  let disk: Promise<Array<OpenedSkill & { name: string }>> | undefined
  const onDisk = () =>
    (disk ??= index().then(async (merged) => {
      const out: Array<OpenedSkill & { name: string }> = []
      for (const { name, origin } of merged) {
        const opened = await sources[origin]?.open?.(name).catch(() => null)
        if (opened) out.push({ name, ...opened })
      }
      return out
    }))
  const section: ContextSection = async (dir) =>
    writeSkills(join(dir, "skills"), await onDisk())

  return {
    index,
    async read(name) {
      for (const { source } of ranked) {
        // A source that can't be read has none of the name; the lookup goes on.
        const body = await source.read(name).catch(() => null)
        if (body !== null) return body
      }
      return null
    },
    async file(name, path) {
      for (const { source } of ranked) {
        const found = await source.file(name, path).catch(() => undefined)
        if (found !== undefined) return found
      }
      return null
    },
    async holders(name) {
      const held = await Promise.all(
        ranked.map(async ({ origin, source }) =>
          (await source.read(name).catch(() => null)) !== null ? origin : null
        )
      )
      return held.filter((o): o is SkillOrigin => o !== null)
    },
    appIndex: () => inputs.app.index(),
    contextSections: () => ({
      [CLAUDE_SKILLS_SECTION]: section,
      [AGENTS_SKILLS_SECTION]: section,
    }),
  }
}

function sourcesOf(
  inputs: SkillSourceInputs
): Partial<Record<SkillOrigin, Source>> {
  return {
    ...(inputs.repo ? { repo: repoSource(inputs.repo) } : {}),
    ...(inputs.canvas ? { canvas: savedSource(inputs.canvas) } : {}),
    ...(inputs.account ? { account: savedSource(inputs.account) } : {}),
    ...(inputs.agent ? { agent: agentSource(inputs.agent) } : {}),
    app: appSource(inputs.app),
  }
}

function repoSource(open: () => Promise<RepoSkillFs | null>): Source {
  // One sandbox lookup per turn.
  let opened: Promise<RepoSkillFs | null> | undefined
  const fs = () => (opened ??= open().catch(() => null))
  return {
    async index() {
      const repo = await fs()
      if (!repo) return []
      // A malformed Repo Skill reads as none, so it can't take down the chat.
      return enumerateRepoSkills(repo).catch((e) => {
        console.error("Repo Skill enumeration failed:", e)
        return []
      })
    },
    async read(name) {
      const repo = await fs()
      return repo ? readRepoSkillFile(repo, name, "SKILL.md") : null
    },
    async file(name, path) {
      const repo = await fs()
      if (!repo || (await readRepoSkillFile(repo, name, "SKILL.md")) === null)
        return undefined
      return readRepoSkillFile(repo, name, path)
    },
  }
}

function savedSource(scope: SavedSkills): Source {
  const open = async (name: string) => {
    const read = await scope.read(name)
    return read.ok ? read.value : null
  }
  return {
    index: () => scope.list(),
    async read(name) {
      const skill = await open(name)
      return skill ? renderSkill(skill.content, skill.files) : null
    },
    async file(name, path) {
      const skill = await open(name)
      return skill ? fileOf(skill, path) : undefined
    },
    async open(name) {
      const skill = await open(name)
      return skill ? { content: skill.content, files: skill.files } : null
    },
  }
}

function agentSource(agent: AgentSkills): Source {
  return {
    index: () => agent.index(),
    read: (name) => agent.read(name),
    file: (name, path) => agent.file(name, path),
  }
}

function appSource(app: AppSkills): Source {
  return {
    index: async () => app.index(),
    read: async (name) => app.read(name),
    async file(name, path) {
      const skill = app.open(name)
      return skill ? fileOf(skill, path) : undefined
    },
    open: async (name) => app.open(name),
  }
}

function fileOf(skill: OpenedSkill, path: string): string | null {
  if (path === "SKILL.md") return skill.content
  return skill.files.find((f) => f.path === path)?.content ?? null
}

function mergeIndexes(
  sources: Array<{ origin: SkillOrigin; skills: readonly SkillMetadata[] }>
): OriginTaggedSkill[] {
  const byName = new Map<string, OriginTaggedSkill>()
  for (const { origin, skills } of sources) {
    for (const s of skills) {
      if (byName.has(s.name)) continue
      byName.set(s.name, { name: s.name, description: s.description, origin })
    }
  }
  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  )
}

/**
 * Render the merged set as the "available skills" listing shown when
 * `read_skill` is asked for a name that resolves to nothing.
 */
export function formatSkillListing(skills: readonly SkillMetadata[]): string {
  if (skills.length === 0) return "(none)"
  return skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")
}

/**
 * Write `skills` into `dir`, one folder each, replacing whatever was there:
 * a deleted Skill, or a file a Skill no longer has, is gone. The folder is
 * rewritten whole each turn; Skills are small.
 */
async function writeSkills(
  dir: string,
  skills: Array<OpenedSkill & { name: string }>
): Promise<void> {
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
