import "server-only"

import { canvasFiles } from "@/lib/files"
import { mediaTypeFor } from "@/lib/files/paths"
import {
  MAX_MOCKUP_REF_BYTES,
  MAX_MOCKUP_REFS,
  parseMockupRef,
  type MockupResource,
} from "@/lib/mockup-refs"
import type { RoomDoc } from "@/lib/room-access"
import { appSkills } from "@/lib/skills"
import { accountSkills } from "@/lib/skills/account"
import { canvasSkills } from "@/lib/skills/canvas"
import { SKILL_ORIGIN_RANK, type SkillOrigin } from "@/lib/skills/merged"
import { repoSkillFsForSandbox } from "@/lib/skills/sandbox-index"
import type { SavedSkills } from "@/lib/skills/saved"

/** A file a reference names: its media type and bytes. */
export interface MockupRefFile {
  type: string
  bytes: Uint8Array
}

/**
 * Where a page's references (`lib/mockup-refs.ts`) come from. A Skill's
 * sources each answer for the Skill as a whole: `undefined` when the source
 * has no Skill of that name, so the next one is tried, else the file (or
 * `null`, the Skill has no such file).
 */
export interface MockupRefSources {
  skill: Partial<
    Record<
      SkillOrigin,
      (skill: string, path: string) => Promise<MockupRefFile | null | undefined>
    >
  >
  canvasFile(path: string): Promise<MockupRefFile | null>
}

/**
 * Resolve a page's references: a `skill:` one from the first source, in
 * Skill precedence (repo, canvas, account, App), that has the Skill, and a
 * `files:` one from the canvas Files. One that doesn't resolve, or comes past
 * {@link MAX_MOCKUP_REFS} or {@link MAX_MOCKUP_REF_BYTES}, is `null`.
 */
export async function resolveMockupRefs(
  refs: readonly string[],
  sources: MockupRefSources
): Promise<Record<string, MockupResource | null>> {
  const out: Record<string, MockupResource | null> = {}
  let bytes = 0
  for (const ref of refs.slice(0, MAX_MOCKUP_REFS)) {
    const file = await resolveOne(ref, sources).catch(() => null)
    if (!file || bytes + file.bytes.byteLength > MAX_MOCKUP_REF_BYTES) {
      out[ref] = null
      continue
    }
    bytes += file.bytes.byteLength
    out[ref] = {
      type: file.type,
      data: Buffer.from(file.bytes).toString("base64"),
    }
  }
  for (const ref of refs.slice(MAX_MOCKUP_REFS)) out[ref] = null
  return out
}

async function resolveOne(
  ref: string,
  sources: MockupRefSources
): Promise<MockupRefFile | null> {
  const parsed = parseMockupRef(ref)
  if (!parsed) return null
  if (parsed.kind === "files") return sources.canvasFile(parsed.path)
  for (const origin of SKILL_ORIGIN_RANK) {
    const found = await sources.skill[origin]?.(parsed.skill, parsed.path)
    if (found !== undefined) return found
  }
  return null
}

/**
 * The references' sources for a Mockup on a Room: the Repo Skills of the
 * Workspace of the chat that made it (while its sandbox runs), the canvas's
 * Skills, `userId`'s Account Skills (the viewer's; none without one), every
 * App Skill, and the canvas Files.
 */
export async function mockupRefSources(
  room: RoomDoc,
  opts: { mockupId: string; userId?: string | null }
): Promise<MockupRefSources> {
  const sandboxName = await room
    .readDoc((c) => {
      const chatId = c.mockupLayers.get(opts.mockupId)?.ownerChatId
      const branchId = chatId ? c.chatSessions.get(chatId)?.branchId : null
      const branch = branchId ? c.branches.get(branchId) : null
      return branch?.status === "running" ? branch.sandboxName : null
    })
    .catch(() => null)
  const repo = sandboxName ? await repoSkillFsForSandbox(sandboxName) : null
  const text = (path: string, content: string): MockupRefFile => ({
    type: mediaTypeFor(path, "text/plain"),
    bytes: new TextEncoder().encode(content),
  })
  const saved = (skills: SavedSkills) => async (name: string, path: string) => {
    const read = await skills.read(name)
    if (!read.ok) return undefined
    const file = read.value.files.find((f) => f.path === path)
    return file ? text(path, file.content) : null
  }
  return {
    skill: {
      ...(repo
        ? {
            repo: async (name: string, path: string) => {
              const dir = `.claude/skills/${name}`
              if ((await repo.read(`${dir}/SKILL.md`)) === null)
                return undefined
              const content = await repo.read(`${dir}/${path}`)
              return content === null ? null : text(path, content)
            },
          }
        : {}),
      canvas: saved(canvasSkills(room)),
      ...(opts.userId ? { account: saved(accountSkills(opts.userId)) } : {}),
      app: async (name, path) => {
        const skill =
          appSkills.open(name, "workspace") ??
          appSkills.open(name, "coordinator")
        if (!skill) return undefined
        const file = skill.files.find((f) => f.path === path)
        return file ? text(path, file.content) : null
      },
    },
    async canvasFile(path) {
      const read = await canvasFiles(room).read(path)
      if (!read.ok) return null
      return {
        type: read.value.entry.mediaType || mediaTypeFor(path, ""),
        bytes: read.value.bytes,
      }
    },
  }
}
