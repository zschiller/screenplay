import type { FileEntryData } from "@/lib/types"
import { baseName } from "./paths"

/**
 * A file's bytes as an HTTP response for the person who may read it. Never
 * cached by anything shared, and sandboxed by CSP so an HTML or SVG file an
 * agent saved can't run script on the app's origin.
 */
export function fileResponse(
  entry: FileEntryData,
  bytes: Uint8Array
): Response {
  const name = baseName(entry.path)
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": entry.mediaType || "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      // Chrome won't show a PDF in a sandboxed document, and its viewer
      // runs nothing on our origin, so a PDF goes without.
      ...(entry.mediaType === "application/pdf"
        ? {}
        : {
            "Content-Security-Policy":
              "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
          }),
      "X-Content-Type-Options": "nosniff",
    },
  })
}
