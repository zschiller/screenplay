import { nanoid } from "nanoid"

import { withBasePath } from "@/lib/base-path"
import { isLocalBuild } from "@/lib/local-mode"
import type { MessageAttachment } from "@/lib/agent/message-markers"
import { SERVER_UPLOAD_MAX_BYTES } from "@/lib/files/attachments"
import { canvasFileKeyPrefix } from "@/lib/files/paths"

/**
 * The browser side of chat attachments (#1525): upload a file a member
 * dropped or pasted into the composer into the canvas's files, take one back
 * out, and the URL a sent message's chip opens.
 */

export type AttachmentUpload =
  { ok: true; attachment: MessageAttachment } | { ok: false; error: string }

const routeFor = (roomId: string) =>
  withBasePath(`/api/chat-attachments/${encodeURIComponent(roomId)}`)

async function answer(res: Response): Promise<AttachmentUpload> {
  const body = (await res.json().catch(() => null)) as
    (MessageAttachment & { error?: string }) | null
  if (!res.ok || !body || body.error) {
    return {
      ok: false,
      error: body?.error ?? "The file couldn’t be attached. Try again.",
    }
  }
  return {
    ok: true,
    attachment: { path: body.path, mediaType: body.mediaType, size: body.size },
  }
}

/**
 * Save `file` into the canvas's files under `uploads/`. On hosted a file too
 * big for a function's body goes straight to the file store from here.
 */
export async function uploadAttachment(
  roomId: string,
  file: File
): Promise<AttachmentUpload> {
  try {
    if (!isLocalBuild && file.size > SERVER_UPLOAD_MAX_BYTES) {
      return await uploadDirect(roomId, file)
    }
    const res = await fetch(
      `${routeFor(roomId)}?name=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      }
    )
    return await answer(res)
  } catch {
    return { ok: false, error: "The file couldn’t be attached. Try again." }
  }
}

async function uploadDirect(
  roomId: string,
  file: File
): Promise<AttachmentUpload> {
  // Loaded only for a big file on hosted, so the desktop bundle and most
  // sessions never fetch it.
  const { upload } = await import("@vercel/blob/client")
  const url = `${routeFor(roomId)}/direct`
  const key = `${canvasFileKeyPrefix(roomId)}/file-${nanoid(12)}`
  await upload(key, file, {
    access: "private",
    handleUploadUrl: url,
    contentType: file.type || "application/octet-stream",
    multipart: true,
  })
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "attachment.complete",
      name: file.name,
      mediaType: file.type,
      key,
    }),
  })
  return answer(res)
}

/** Delete an attachment taken out of the composer before it was sent. */
export async function removeAttachment(
  roomId: string,
  path: string
): Promise<void> {
  await fetch(`${routeFor(roomId)}?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
  }).catch(() => {})
}

/** Where an attached file opens: the canvas files route, for members only. */
export function attachmentUrl(roomId: string, path: string): string {
  return withBasePath(
    `/api/canvas-files/${encodeURIComponent(roomId)}/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`
  )
}
