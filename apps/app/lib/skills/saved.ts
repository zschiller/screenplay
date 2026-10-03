import { createFiles, type FileAuthor, type FileIndex } from "@/lib/files/files"
import { ancestorPaths, isWithin, normalizeFilePath } from "@/lib/files/paths"
import type { FileStore } from "@/lib/files/store"
import type { FileEntryData } from "@/lib/types"

import { parseFrontmatter } from "./frontmatter"

/**
 * The **skills module** (#1555, spec #1554): Skills a chat saved, as opposed
 * to the ones screenplay ships (App Skills) or a repository carries (Repo
 * Skills). One set of verbs (list, read, save, remove) over a scope's Skills;
 * the agent tools, the Settings sections and the per-turn writer all go
 * through it. Only the canvas scope exists so far (Canvas Skills); account
 * skills will be a second scope over the same module.
 *
 * A saved Skill is a folder named after it holding a `SKILL.md` and, if it
 * has any, supporting text files beside it, as the Agent Skills format
 * allows. The folders live in a files module scope of their own
 * (`lib/files`), with its own index, so they never show in the Files trees.
 * The Skill's folder entry also carries its description, so listing Skills
 * reads no bytes.
 */

/** The longest Skill name, per the Agent Skills format. */
export const SKILL_NAME_MAX_LENGTH = 64

/** The longest description, per the Agent Skills format. */
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024

/** The most a whole Skill (`SKILL.md` and its files) can be, in bytes. */
export const SKILL_MAX_BYTES = 256 * 1024

const SKILL_FILE = "SKILL.md"

/** A saved Skill, as a listing shows it. */
export interface SavedSkill {
  name: string
  description: string
  /** Who saved it last: an agent chat, or a member. */
  addedBy: FileEntryData["addedBy"]
  /** The chat (for an agent) or user (for a member) that saved it last. */
  addedById: string
  createdAt: number
  updatedAt: number
}

/** A supporting file of a Skill: a path inside its folder, and its text. */
export interface SkillFile {
  path: string
  content: string
}

export type SkillResult<T> =
  { ok: true; value: T } | { ok: false; error: string }

export interface SavedSkills {
  /** Every Skill, by name. */
  list(): Promise<SavedSkill[]>
  /** A Skill's `SKILL.md` and its supporting files. */
  read(
    name: string
  ): Promise<
    SkillResult<{ skill: SavedSkill; content: string; files: SkillFile[] }>
  >
  /**
   * Save a Skill, replacing one of the same name. Its `SKILL.md`'s
   * `allowed-tools` and `` !`command` `` lines are stripped first; `stripped`
   * says which kinds went.
   */
  save(input: {
    name: string
    content: string
    files?: readonly SkillFile[]
    author: FileAuthor
    now?: number
  }): Promise<
    SkillResult<{ skill: SavedSkill; replaced: boolean; stripped: string[] }>
  >
  /** Delete a Skill with everything in its folder. */
  remove(name: string): Promise<SkillResult<void>>
}

/** A Skill's folder entry: a folder entry that also carries its description. */
type SkillFolderEntry = FileEntryData & { description?: string }

const ok = <T>(value: T): SkillResult<T> => ({ ok: true, value })
const fail = <T>(error: string): SkillResult<T> => ({ ok: false, error })

/**
 * Whether `name` is a valid Skill name (the Agent Skills rule): lowercase
 * letters, digits and single hyphens between them, at most 64 characters.
 * Returns what's wrong, or null.
 */
export function skillNameError(name: string): string | null {
  if (!name) return "The skill needs a name."
  if (name.length > SKILL_NAME_MAX_LENGTH) {
    return `"${name}" is over ${SKILL_NAME_MAX_LENGTH} characters.`
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    return `"${name}" isn't a valid skill name: use lowercase letters, digits and single hyphens, like "release-checklist".`
  }
  return null
}

/**
 * `content` without what would let a saved Skill act on its own when a
 * harness loads it: the `allowed-tools` frontmatter field (tools it may use
 * without asking) and lines with an inline `` !`command` `` (run at load
 * time). Claude Code honours both without asking, and a canvas Skill is
 * written by one member's chat and followed in another's.
 */
export function stripSkillPrivileges(content: string): {
  content: string
  stripped: string[]
} {
  const stripped = new Set<string>()
  const lines = content.replaceAll("\r\n", "\n").split("\n")
  const out: string[] = []
  let inFrontmatter = lines[0]?.trim() === "---"
  let skippingField = false
  for (const [i, line] of lines.entries()) {
    if (inFrontmatter && i > 0 && line.trim() === "---") {
      inFrontmatter = false
      skippingField = false
      out.push(line)
      continue
    }
    if (inFrontmatter && i > 0) {
      if (/^allowed-tools\s*:/i.test(line)) {
        stripped.add("allowed-tools")
        skippingField = true
        continue
      }
      // The field's own lines: a YAML list or a continued value, indented.
      if (skippingField && /^(\s+|\s*-\s)/.test(line)) continue
      skippingField = false
    }
    if (/!`[^`]*`/.test(line)) {
      stripped.add("!`command` lines")
      continue
    }
    out.push(line)
  }
  return { content: out.join("\n"), stripped: [...stripped] }
}

const toSkill = (entry: SkillFolderEntry): SavedSkill => ({
  name: entry.path,
  description: entry.description ?? "",
  addedBy: entry.addedBy,
  addedById: entry.addedById,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
})

/** Each Skill's folder entry. One without a description is mid-save. */
function skillFolders(entries: readonly FileEntryData[]): SkillFolderEntry[] {
  return (entries as SkillFolderEntry[]).filter(
    (e) =>
      e.kind === "folder" &&
      !e.path.includes("/") &&
      typeof e.description === "string"
  )
}

/** The Skills a scope's index entries hold, by name. */
export function savedSkillsIn(entries: readonly FileEntryData[]): SavedSkill[] {
  return skillFolders(entries)
    .map(toSkill)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function createSavedSkills(scope: {
  index: FileIndex
  store: FileStore
  keyPrefix: string
}): SavedSkills {
  const files = createFiles(scope)
  const { index } = scope

  const folders = async () => skillFolders(await index.entries())

  return {
    async list() {
      return savedSkillsIn(await index.entries())
    },

    async read(name) {
      if (skillNameError(name)) return fail(`No skill named "${name}".`)
      const folder = (await folders()).find((e) => e.path === name)
      if (!folder) return fail(`No skill named "${name}".`)
      const listed = await files.list(name)
      if (!listed.ok) return fail(listed.error)
      const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
      const main = await files.read(`${name}/${SKILL_FILE}`)
      if (!main.ok) return fail(main.error)
      const supporting: SkillFile[] = []
      for (const entry of listed.value) {
        if (entry.kind !== "file") continue
        const path = entry.path.slice(name.length + 1)
        if (path === SKILL_FILE) continue
        const read = await files.read(entry.path)
        if (read.ok)
          supporting.push({ path, content: decode(read.value.bytes) })
      }
      return ok({
        skill: toSkill(folder),
        content: decode(main.value.bytes),
        files: supporting,
      })
    },

    async save({ name, content: raw, files: rawFiles = [], author, now }) {
      const nameError = skillNameError(name)
      if (nameError) return fail(nameError)
      const { content, stripped } = stripSkillPrivileges(raw)
      let metadata
      try {
        metadata = parseFrontmatter(content, `"${name}"`).metadata
      } catch (e) {
        return fail(
          `${e instanceof Error ? e.message : String(e)} Start SKILL.md with:\n---\nname: ${name}\ndescription: <what it does and when to use it>\n---`
        )
      }
      if (metadata.name !== name) {
        return fail(
          `SKILL.md declares name "${metadata.name}"; it must match the skill's name, "${name}".`
        )
      }
      if (metadata.description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
        return fail(
          `The description is ${metadata.description.length} characters; the most is ${SKILL_DESCRIPTION_MAX_LENGTH}.`
        )
      }

      const encoder = new TextEncoder()
      const writes: { path: string; bytes: Uint8Array }[] = [
        { path: SKILL_FILE, bytes: encoder.encode(content) },
      ]
      for (const f of rawFiles) {
        const p = normalizeFilePath(f.path)
        if ("error" in p) return fail(p.error)
        if (p.path === SKILL_FILE) {
          return fail(`Pass SKILL.md as \`content\`, not as a file.`)
        }
        if (writes.some((w) => w.path === p.path)) {
          return fail(`"${p.path}" is in the files twice.`)
        }
        writes.push({ path: p.path, bytes: encoder.encode(f.content) })
      }
      const size = writes.reduce((n, w) => n + w.bytes.byteLength, 0)
      if (size > SKILL_MAX_BYTES) {
        return fail(
          `The skill is ${size} bytes; the most a skill can be, with its files, is ${SKILL_MAX_BYTES} (256 KB).`
        )
      }

      const at = now ?? Date.now()
      const before = (await index.entries()).find((e) => e.path === name)
      if (before?.kind === "file") {
        // Only this module writes the index; a file at the top is a leftover.
        await files.remove(name)
      }
      const replaced = !!(before as SkillFolderEntry | undefined)?.description

      for (const w of writes) {
        const saved = await files.save({
          path: `${name}/${w.path}`,
          bytes: w.bytes,
          fallbackMediaType: "text/plain",
          author,
          now: at,
        })
        if (!saved.ok) return fail(saved.error)
      }

      // Drop what the last save had and this one doesn't.
      const keep = new Set(
        writes.flatMap((w) => [
          `${name}/${w.path}`,
          ...ancestorPaths(`${name}/${w.path}`),
        ])
      )
      const listed = await files.list(name)
      if (listed.ok) {
        // By path, so a folder comes before what's in it and goes with it.
        const gone: string[] = []
        for (const e of listed.value) {
          if (keep.has(e.path) || gone.some((f) => isWithin(e.path, f))) {
            continue
          }
          await files.remove(e.path)
          gone.push(e.path)
        }
      }

      // Last, the description: until it's there, the Skill isn't listed.
      const skill = await index.mutate((tx) => {
        const folder = tx.all().find((e) => e.path === name)
        if (!folder) return null
        const next: SkillFolderEntry = {
          ...folder,
          description: metadata.description,
          addedBy: author.addedBy,
          addedById: author.addedById,
          createdAt: replaced ? folder.createdAt : at,
          updatedAt: at,
        }
        tx.set(next)
        return toSkill(next)
      })
      if (!skill) return fail(`"${name}" was deleted while it was saving.`)
      return ok({ skill, replaced, stripped })
    },

    async remove(name) {
      if (skillNameError(name)) return fail(`No skill named "${name}".`)
      const folder = (await index.entries()).find((e) => e.path === name)
      if (!folder || folder.kind !== "folder") {
        return fail(`No skill named "${name}".`)
      }
      const removed = await files.remove(name)
      return removed.ok ? ok(undefined) : fail(removed.error)
    },
  }
}
