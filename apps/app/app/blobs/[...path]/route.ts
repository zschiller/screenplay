import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { join, normalize, resolve, sep } from "node:path"
import { Readable } from "node:stream"

import { isLocalBuild } from "@/lib/local-mode"

/**
 * Serves the local-fs {@link import("@/lib/blob/local-fs").BlobStore}'s
 * directory over the sidecar's own localhost origin.
 *
 * The local-fs store writes blobs (today: Room thumbnails) under
 * `LOCAL_BLOB_DIR` and hands back `${LOCAL_BLOB_BASE_URL}/${key}` URLs. On the
 * hosted build Vercel Blob serves those URLs from its CDN; the desktop build has
 * no CDN, so *this* route is the "static localhost server" the store's contract
 * assumes — point `LOCAL_BLOB_BASE_URL` at `http://127.0.0.1:${PORT}/blobs` and
 * the webview fetches thumbnails straight back from the Node sidecar.
 *
 * Local-build only: the hosted deployment never selects the local-fs store, so
 * this returns 404 there and the route is dead-code on that path.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_DIR = ".screenplay/blobs"

const CONTENT_TYPES: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  if (!isLocalBuild) return new Response("Not found", { status: 404 })

  const { path: segments } = await params
  const root = resolve(process.env.LOCAL_BLOB_DIR ?? DEFAULT_DIR)

  // Resolve the request under the blob root and refuse anything that escapes it
  // (`..`, absolute segments) — a path-traversal guard, since the key comes off
  // the URL. `normalize` collapses `..`; the prefix check rejects a climb-out.
  const key = normalize(join(...segments))
  const filePath = resolve(root, key)
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    return new Response("Forbidden", { status: 403 })
  }

  let size: number
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return new Response("Not found", { status: 404 })
    size = info.size
  } catch {
    return new Response("Not found", { status: 404 })
  }

  const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream"

  const body = Readable.toWeb(
    createReadStream(filePath)
  ) as unknown as ReadableStream<Uint8Array>

  return new Response(body, {
    headers: {
      "content-type": contentType,
      "content-length": String(size),
      // Thumbnails are overwritten in place on recapture; keep the webview from
      // pinning a stale render. Short max-age matches the store's put().
      "cache-control": "public, max-age=60",
    },
  })
}
