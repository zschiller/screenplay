import type { FileEntryData } from "@/lib/types"

/**
 * Paths and media types for saved files: Canvas Files (#1514) and Account
 * Files (#1521). A path is folders joined by
 * `/` with no leading or trailing slash, the way an agent names one and the
 * Files tree shows it.
 */

/**
 * Where a Room's Canvas Files keep their bytes in the file store: each file
 * under `<prefix>/<id>`.
 */
export function canvasFileKeyPrefix(roomId: string): string {
  return `canvas/${roomId}`
}

/**
 * Where one person's Account Files (#1521) keep their bytes: each file under
 * `<prefix>/<id>`.
 */
export function accountFileKeyPrefix(userId: string): string {
  return `account/${encodeURIComponent(userId)}`
}

/** The longest path kept, in characters. */
export const FILE_PATH_MAX_LENGTH = 512

/** The longest single name (one segment of a path). */
const NAME_MAX_LENGTH = 255

/**
 * The tidy form of `raw` (slashes trimmed and collapsed, `./` dropped), or an
 * error that says what's wrong with it. A `..` segment, a control character or
 * an empty path is refused rather than guessed at.
 */
export function normalizeFilePath(
  raw: string
): { path: string } | { error: string } {
  const segments = raw
    .trim()
    .replaceAll("\\", "/")
    .split("/")
    .filter((s) => s !== "" && s !== ".")
  if (segments.length === 0) return { error: "The path is empty." }
  for (const s of segments) {
    if (s === "..") return { error: `"${raw}" climbs out with "..".` }
    if (/[\u0000-\u001f\u007f]/.test(s)) {
      return { error: `"${raw}" has a control character in it.` }
    }
    if (s.length > NAME_MAX_LENGTH) {
      return {
        error: `A name in "${raw}" is over ${NAME_MAX_LENGTH} characters.`,
      }
    }
  }
  const path = segments.join("/")
  if (path.length > FILE_PATH_MAX_LENGTH) {
    return { error: `The path is over ${FILE_PATH_MAX_LENGTH} characters.` }
  }
  return { path }
}

/** The folder `path` sits in, or "" at the top. */
export function parentPath(path: string): string {
  const i = path.lastIndexOf("/")
  return i === -1 ? "" : path.slice(0, i)
}

/** The last segment of `path`. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}

/** Every folder above `path`, outermost first: `a/b/c.md` → `a`, `a/b`. */
export function ancestorPaths(path: string): string[] {
  const segments = path.split("/").slice(0, -1)
  return segments.map((_, i) => segments.slice(0, i + 1).join("/"))
}

/** Whether `path` is `folder` itself or anything inside it. */
export function isWithin(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`)
}

const MEDIA_TYPES: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  ts: "text/x-typescript",
  tsx: "text/x-typescript",
  jsx: "text/javascript",
  py: "text/x-python",
  sh: "text/x-shellscript",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  xml: "application/xml",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  zip: "application/zip",
}

/** A media type from the path's extension, or `fallback` for an unknown one. */
export function mediaTypeFor(path: string, fallback: string): string {
  const name = baseName(path)
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return fallback
  return MEDIA_TYPES[name.slice(dot + 1).toLowerCase()] ?? fallback
}

/** Whether a file of `mediaType` reads as text. */
export function isTextMediaType(mediaType: string): boolean {
  return (
    mediaType.startsWith("text/") ||
    mediaType === "application/json" ||
    mediaType === "application/yaml" ||
    mediaType === "application/toml" ||
    mediaType === "application/xml" ||
    mediaType === "image/svg+xml"
  )
}

/** A size the way a person reads one: `812 B`, `2.1 KB`, `3.4 MB`. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** One line of a listing: a folder ends in `/`, a file gives size and type. */
export function fileEntryLine(entry: FileEntryData): string {
  return entry.kind === "folder"
    ? `- ${entry.path}/`
    : `- ${entry.path} (${formatFileSize(entry.size)}, ${entry.mediaType})`
}

/**
 * `path`, or the first free one beside it when `taken` says it's used:
 * `a/photo.png`, then `a/photo-2.png`, `a/photo-3.png`.
 */
export function freePath(
  path: string,
  taken: (path: string) => boolean
): string {
  const folder = parentPath(path)
  const name = baseName(path)
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ""
  let candidate = path
  for (let n = 2; taken(candidate); n++) {
    candidate = `${folder ? `${folder}/` : ""}${stem}-${n}${ext}`
  }
  return candidate
}
