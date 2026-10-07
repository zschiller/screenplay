import { fileStore } from "@/lib/files"
import { mediaTypeFor, normalizeFilePath } from "@/lib/files/paths"
import { MOCKUP_INDEX, mockupFolderPrefix } from "@/lib/mockup-folder"
import { verifyMockupPageToken } from "@/lib/mockup-folder-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * One file of a Mockup's folder (#1886), for the Mockup's own page: what its
 * relative paths load, through the `<base>` the canvas gives it. The page
 * runs in an opaque origin and sends no cookies, so the token in the path is
 * the check, not a session: signed for one Mockup in one canvas and minted
 * only for its members (`lib/mockup-folder-server.ts`).
 * `GET /api/mockup-pages/<token>/r<revision>/<path>`; the revision is only
 * there so a write reloads the page, and the folder is always read as it is.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; path: string[] }> }
): Promise<Response> {
  const { token, path } = await params
  const claims = verifyMockupPageToken(token)
  if (!claims) return new Response("Not found", { status: 404 })
  const [revision, ...rest] = path
  if (!revision || !/^r\d+$/.test(revision)) {
    return new Response("Not found", { status: 404 })
  }
  // Segments come decoded, so one may hold a "/" or a ".." of its own:
  // normalize the whole path, and refuse one that climbs out.
  const file = rest.length ? normalizeFilePath(rest.join("/")) : null
  if (file && "error" in file) {
    return new Response("Not found", { status: 404 })
  }
  const bytes = await fileStore.get(
    mockupFolderPrefix(claims.roomId, claims.fileId) +
      (file?.path ?? MOCKUP_INDEX)
  )
  if (!bytes) return new Response("Not found", { status: 404 })
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": mediaTypeFor(
        file?.path ?? MOCKUP_INDEX,
        "application/octet-stream"
      ),
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // The page is in an opaque origin, so its own `fetch` is cross-origin.
      // No cookie ever rides on it: the token is the credential.
      "Access-Control-Allow-Origin": "*",
      // Opened on its own, a file still can't act as the app.
      "Content-Security-Policy": "sandbox allow-scripts",
    },
  })
}
