import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { openRoomForRoute } from "@/lib/room-access"
import { blobStoreChoiceFromEnv } from "@/lib/blob/select"
import { canvasFiles, fileStore } from "@/lib/files"
import { adoptAttachment } from "@/lib/files/attach"
import { ATTACHMENT_MAX_BYTES } from "@/lib/files/attachments"
import { canvasFileKeyPrefix } from "@/lib/files/paths"
import { PRIVATE_BLOB_TOKEN_ENV_VAR } from "@/lib/files/vercel"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** The browser's word that its upload finished, naming the key it used. */
interface CompleteBody {
  type: "attachment.complete"
  name: string
  /** The type the browser gave the file. */
  mediaType: string
  key: string
}

/**
 * Chat attachments too big for a function's 4.5 MB body (#1525), on hosted:
 * the browser uploads them straight to the private file store.
 *
 * `POST /api/chat-attachments/<roomId>/direct` takes `@vercel/blob/client`'s
 * token request, for a key under this canvas's files only, then the
 * browser's `{ type: "attachment.complete", name, mediaType, key }` once the
 * bytes are up, which adds the file to the canvas's files under `uploads/`
 * and answers `{ path, mediaType, size }` (or `{ error }`).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> }
): Promise<Response> {
  const { roomId } = await params
  // Local disk has no 4.5 MB limit: the desktop build uploads everything
  // through the plain route.
  if (blobStoreChoiceFromEnv() === "local-fs") {
    return new Response("Not found", { status: 404 })
  }
  const room = await openRoomForRoute(roomId)
  if (room instanceof Response) return room

  const body = (await req.json()) as HandleUploadBody | CompleteBody
  const keyPrefix = `${canvasFileKeyPrefix(roomId)}/`

  if (body.type === "attachment.complete") {
    if (!isUploadKey(body.key, keyPrefix)) {
      return Response.json(
        { error: "That upload isn't this canvas's." },
        {
          status: 400,
        }
      )
    }
    const adopted = await adoptAttachment(canvasFiles(room), fileStore, {
      name: body.name,
      type: body.mediaType,
      blobKey: body.key,
      userId: room.userId,
    })
    if (!adopted.ok) {
      return Response.json({ error: adopted.error }, { status: 400 })
    }
    return Response.json(adopted.value)
  }

  // Only a token request: a completion callback would come from Vercel with
  // no member's session, and none is asked for.
  if (body.type !== "blob.generate-client-token") {
    return new Response("Bad request", { status: 400 })
  }
  try {
    const result = await handleUpload({
      body,
      request: req,
      token: process.env[PRIVATE_BLOB_TOKEN_ENV_VAR],
      onBeforeGenerateToken: async (pathname) => {
        if (!isUploadKey(pathname, keyPrefix)) {
          throw new Error("That upload isn't this canvas's.")
        }
        return {
          maximumSizeInBytes: ATTACHMENT_MAX_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
        }
      },
    })
    return Response.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return Response.json({ error: message }, { status: 400 })
  }
}

/** A fresh file key in this canvas's part of the store. */
function isUploadKey(key: string, keyPrefix: string): boolean {
  return (
    key.startsWith(keyPrefix) &&
    /^file-[A-Za-z0-9_-]{8,40}$/.test(key.slice(keyPrefix.length))
  )
}
