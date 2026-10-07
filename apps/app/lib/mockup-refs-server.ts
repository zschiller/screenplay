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
import { chatSkillSources } from "@/lib/agent/chat-skill-sources"
import { layerFileOf } from "@/lib/yjs/file-views"
import { lastChangedBy } from "@/lib/canvas/layer-chat"

/** A file a reference names: its media type and bytes. */
export interface MockupRefFile {
  type: string
  bytes: Uint8Array
}

/** Where a page's references (`lib/mockup-refs.ts`) come from. */
export interface MockupRefSources {
  /** A file of a Skill, by the Skill precedence; `null` when it has none. */
  skillFile(skill: string, path: string): Promise<MockupRefFile | null>
  canvasFile(path: string): Promise<MockupRefFile | null>
}

/**
 * Resolve a page's references: a `skill:` one from the Skill Sources of the
 * chat that made the page, and a `files:` one from the canvas Files. One that
 * doesn't resolve, or comes past {@link MAX_MOCKUP_REFS} or
 * {@link MAX_MOCKUP_REF_BYTES}, is `null`.
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
  return sources.skillFile(parsed.skill, parsed.path)
}

/**
 * The references' sources for a Mockup on a Room: the Skills the chat that
 * last changed it sees (#1724) (`read_skill`'s, with `userId`'s Account Skills, the viewer's;
 * none without one), and the canvas Files.
 */
export async function mockupRefSources(
  room: RoomDoc,
  opts: { mockupId: string; userId?: string | null }
): Promise<MockupRefSources> {
  const chatId = await room
    .readDoc((c) => {
      // A view's id or its file's (#1883): the file names the last chat.
      const file = layerFileOf(c, opts.mockupId)
      return file && lastChangedBy(file)
    })
    .catch(() => undefined)
  const skills = await chatSkillSources(room, chatId, opts.userId ?? null)
  return {
    async skillFile(name, path) {
      const content = await skills.file(name, path)
      return content === null
        ? null
        : {
            type: mediaTypeFor(path, "text/plain"),
            bytes: new TextEncoder().encode(content),
          }
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
