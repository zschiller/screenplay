import { FILE_MAX_BYTES } from "./files"
import { baseName, formatFileSize, mediaTypeFor } from "./paths"

/**
 * **Attachments** (#1525): files a person drops or pastes into a chat
 * message. Each is saved into Canvas Files under {@link UPLOADS_FOLDER}, and
 * the message carries a hidden marker naming it (`message-markers.ts`).
 *
 * Isomorphic: the composer checks a file here before uploading it, and the
 * upload routes check it again before saving.
 */

/** The Canvas Files folder attachments land in. */
export const UPLOADS_FOLDER = "uploads"

/** The largest attachment, in bytes: the files module's cap. */
export const ATTACHMENT_MAX_BYTES = FILE_MAX_BYTES

/**
 * The largest file sent through the app's own upload route. A Vercel function
 * takes a body of at most 4.5 MB, so on hosted a bigger file goes straight
 * from the browser to the file store.
 */
export const SERVER_UPLOAD_MAX_BYTES = 4 * 1024 * 1024

/** Image types every model reads inline. */
export const MODEL_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
])

/**
 * The largest image sent to the model inline, in bytes: the most Anthropic's
 * API takes. A bigger one is still attached, and opened on demand.
 */
export const INLINE_IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** Extensions of text and code files an agent can read. */
const TEXT_EXTENSIONS = new Set([
  "md",
  "markdown",
  "mdx",
  "txt",
  "text",
  "log",
  "csv",
  "tsv",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "xml",
  "svg",
  "html",
  "htm",
  "css",
  "scss",
  "less",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "mts",
  "cts",
  "tsx",
  "vue",
  "svelte",
  "astro",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "php",
  "sh",
  "bash",
  "zsh",
  "fish",
  "sql",
  "graphql",
  "gql",
  "prisma",
  "proto",
  "diff",
  "patch",
])

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"])

/** What a person tried to attach, as a browser `File` describes it. */
export interface AttachmentCandidate {
  name: string
  size: number
  /** The browser's media type; often empty or wrong for code files. */
  type: string
}

export type AttachmentCheck =
  | {
      ok: true
      /** The file's name, tidied to one path segment. */
      name: string
      /** The media type it's saved with. */
      mediaType: string
    }
  | { ok: false; error: string }

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase()
}

/**
 * A pasted screenshot arrives as `image.png`; a file with no usable name
 * gets one from its type, so it still saves somewhere readable.
 */
function tidyName(name: string, type: string): string {
  const base = baseName(name.replaceAll("\\", "/"))
    // Control characters and the path separator never reach a path.
    .replace(/[\u0000-\u001f\u007f/]/g, "")
    .trim()
  if (base && base !== "." && base !== "..") return base.slice(-200)
  const ext = type.startsWith("image/") ? type.slice("image/".length) : "txt"
  return `attachment.${ext === "jpeg" ? "jpg" : ext}`
}

/**
 * Whether a file can be attached, and as what. Images (PNG, JPEG, GIF, WebP),
 * PDFs, and text and code files are taken, up to {@link ATTACHMENT_MAX_BYTES};
 * anything else is refused with a sentence that says why.
 */
export function checkAttachment(file: AttachmentCandidate): AttachmentCheck {
  const name = tidyName(file.name, file.type)
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return {
      ok: false,
      error: `${name} is ${formatFileSize(file.size)}. Files can be up to ${formatFileSize(ATTACHMENT_MAX_BYTES)}.`,
    }
  }
  const ext = extensionOf(name)
  const type = file.type.toLowerCase()
  if (IMAGE_EXTENSIONS.has(ext) || MODEL_IMAGE_TYPES.has(type)) {
    const mediaType = MODEL_IMAGE_TYPES.has(type)
      ? type
      : mediaTypeFor(name, "image/png")
    return { ok: true, name, mediaType }
  }
  if (ext === "pdf" || type === "application/pdf") {
    return { ok: true, name, mediaType: "application/pdf" }
  }
  // An extension says more than the browser's type: `.ts` arrives as an
  // MPEG transport stream.
  if (TEXT_EXTENSIONS.has(ext) || (!ext && type.startsWith("text/"))) {
    return { ok: true, name, mediaType: mediaTypeFor(name, "text/plain") }
  }
  if (type.startsWith("text/")) {
    return { ok: true, name, mediaType: type.split(";")[0]! }
  }
  return {
    ok: false,
    error: `${name} can’t be attached. Agents read images, PDFs, and text and code files.`,
  }
}

/** Whether an attachment of `mediaType` goes to the model inline. */
export function isInlineImage(mediaType: string, size: number): boolean {
  return MODEL_IMAGE_TYPES.has(mediaType) && size <= INLINE_IMAGE_MAX_BYTES
}

/** The file picker's `accept` list: the files {@link checkAttachment} takes. */
export const ATTACHMENT_ACCEPT = [
  ...[...IMAGE_EXTENSIONS, "pdf", ...TEXT_EXTENSIONS].map((ext) => `.${ext}`),
  ...MODEL_IMAGE_TYPES,
  "application/pdf",
  "text/*",
].join(",")
