import "server-only"

import type { MessageAttachment } from "@/lib/agent/message-markers"
import { parseAttachmentsFooter } from "@/lib/agent/message-markers"
import { blockText, type ContentBlock } from "@/lib/agent/acp/schema"
import { checkAttachment, isInlineImage, UPLOADS_FOLDER } from "./attachments"
import type { FileResult, Files } from "./files"
import { isWithin } from "./paths"
import type { FileStore } from "./store"

/**
 * Attachments on the server (#1525): saving what a member attached into
 * Canvas Files under `uploads/`, and handing an attached image to the model
 * on the turn it was sent.
 */

const fail = <T>(error: string): FileResult<T> => ({ ok: false, error })

function attachmentOf(entry: {
  path: string
  mediaType: string
  size: number
}): MessageAttachment {
  return { path: entry.path, mediaType: entry.mediaType, size: entry.size }
}

/**
 * Save a file a member attached, sent through the app's upload route, at
 * `uploads/<name>` (beside any file already there, with a suffix).
 */
export async function saveAttachment(
  files: Files,
  input: { name: string; type: string; bytes: Uint8Array; userId: string }
): Promise<FileResult<MessageAttachment>> {
  const check = checkAttachment({
    name: input.name,
    size: input.bytes.byteLength,
    type: input.type,
  })
  if (!check.ok) return fail(check.error)
  const saved = await files.save({
    path: `${UPLOADS_FOLDER}/${check.name}`,
    bytes: input.bytes,
    mediaType: check.mediaType,
    fallbackMediaType: check.mediaType,
    author: { addedBy: "member", addedById: input.userId },
    keepExisting: true,
  })
  if (!saved.ok) return saved
  return { ok: true, value: attachmentOf(saved.value.entry) }
}

/**
 * Take a file a member's browser uploaded straight to the file store (one too
 * big for the upload route) into Canvas Files the way {@link saveAttachment}
 * would. Bytes that turn out to be too big or of a refused type are deleted.
 */
export async function adoptAttachment(
  files: Files,
  store: FileStore,
  input: { name: string; type: string; blobKey: string; userId: string }
): Promise<FileResult<MessageAttachment>> {
  const size = await store.size(input.blobKey)
  if (size === null) return fail("The upload didn't arrive. Try again.")
  const check = checkAttachment({ name: input.name, size, type: input.type })
  if (!check.ok) {
    await store.delete([input.blobKey]).catch(() => {})
    return fail(check.error)
  }
  const adopted = await files.adopt({
    path: `${UPLOADS_FOLDER}/${check.name}`,
    blobKey: input.blobKey,
    size,
    mediaType: check.mediaType,
    author: { addedBy: "member", addedById: input.userId },
    keepExisting: true,
  })
  if (!adopted.ok) return adopted
  return { ok: true, value: attachmentOf(adopted.value.entry) }
}

/**
 * Delete an attachment its sender took back out of the composer before
 * sending. Only a file under `uploads/` that this member added goes; anything
 * an agent saved or someone else attached stays.
 */
export async function removeAttachment(
  files: Files,
  path: string,
  userId: string
): Promise<FileResult<null>> {
  const listed = await files.list()
  if (!listed.ok) return listed
  const entry = listed.value.find((e) => e.path === path)
  if (
    !entry ||
    entry.kind !== "file" ||
    !isWithin(entry.path, UPLOADS_FOLDER) ||
    entry.addedBy !== "member" ||
    entry.addedById !== userId
  ) {
    return fail("That isn't an attachment you added.")
  }
  const removed = await files.remove(entry.path)
  return removed.ok ? { ok: true, value: null } : removed
}

/**
 * A user turn's content with each image it attached added as an ACP image
 * block, so the model sees it on this turn without opening it. Other types,
 * an image over the inline cap, and a file that's gone stay as the footer's
 * paths, opened on demand. The stored turn keeps only its text.
 */
export async function withAttachedImages(
  files: Files,
  blocks: ContentBlock[]
): Promise<ContentBlock[]> {
  const attached = parseAttachmentsFooter(
    blocks.map(blockText).join("")
  ).filter((a) => isInlineImage(a.mediaType, a.size))
  if (attached.length === 0) return blocks
  const images = await Promise.all(
    attached.map(async (a): Promise<ContentBlock | null> => {
      const read = await files.read(a.path).catch(() => null)
      if (!read?.ok) return null
      const { entry, bytes } = read.value
      if (!isInlineImage(entry.mediaType, bytes.byteLength)) return null
      return {
        type: "image",
        mimeType: entry.mediaType,
        data: Buffer.from(bytes).toString("base64"),
      }
    })
  )
  return [...blocks, ...images.filter((b): b is ContentBlock => b !== null)]
}
