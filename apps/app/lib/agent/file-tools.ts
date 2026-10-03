import "server-only"

import { tool, jsonSchema, type JSONSchema7 } from "ai"
import { annotateTools } from "@/lib/mcp/tool-server"
import {
  imageModelOutput,
  type FileToolOutput,
  type ImageToolOutput,
} from "@/lib/agent/image-output"
import type { Files } from "@/lib/files/files"
import {
  baseName,
  fileEntryLine,
  formatFileSize,
  isTextMediaType,
} from "@/lib/files/paths"

/**
 * A chat's saved-file tools (#1514): every chat kind lists, reads, saves,
 * moves and deletes the canvas's files and makes folders in them. Each takes
 * a `scope`; only `canvas` exists until Account Files land.
 *
 * Their names say "saved" so they never collide with a Workspace chat's own
 * `read_file` and `list_files`, which reach the repository instead.
 */
export interface FileToolContext {
  /** The canvas's files. */
  canvas: Files
  /** The chat the tools act for: what its saves record as their author. */
  chatId: string
  /**
   * Reads a file from the chat's Sandbox (or host, on the desktop), so
   * `save_file` can keep a binary file. Absent on a chat with neither.
   */
  readSource?: (path: string) => Promise<Uint8Array | null>
}

/** The most text `read_saved_file` returns, in characters. */
export const READ_TEXT_MAX_CHARS = 100_000

/** The largest image handed to the model, in bytes. */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024

const MODEL_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
])

const scopeProperty: JSONSchema7 = {
  type: "string",
  enum: ["canvas"],
  description:
    "Whose files: `canvas` (shared with this canvas's members). The default.",
}

type Scope = { scope?: "canvas" }

export function buildFileTools(ctx: FileToolContext) {
  const author = { addedBy: "agent" as const, addedById: ctx.chatId }
  const files = (_scope: Scope["scope"]) => ctx.canvas

  const sourceProperty: Record<string, JSONSchema7> = ctx.readSource
    ? {
        source_path: {
          type: "string",
          description:
            "Instead of `content`: a file in your sandbox to save as is, such as an image or PDF you made. Relative to the project root, or absolute.",
        },
      }
    : {}

  const tools = {
    list_saved_files: tool({
      description:
        "List the canvas's saved files: every folder and file, with each file's size and media type. These files are shared with the canvas's members and never shown on the canvas or kept in the repository. Pass `folder` to list only what's inside one.",
      inputSchema: jsonSchema<Scope & { folder?: string }>({
        type: "object",
        properties: {
          scope: scopeProperty,
          folder: { type: "string" },
        },
      }),
      execute: async ({ scope, folder }) => {
        const result = await files(scope).list(folder)
        if (!result.ok) return `Error: ${result.error}`
        if (result.value.length === 0) {
          return folder ? `"${folder}" is empty.` : "No saved files yet."
        }
        return result.value.map(fileEntryLine).join("\n")
      },
    }),

    read_saved_file: tool({
      description:
        "Open one of the canvas's saved files by its path. Text comes back as text; an image or a PDF comes back for you to see. Open only the files the task needs.",
      inputSchema: jsonSchema<Scope & { path: string }>({
        type: "object",
        properties: {
          scope: scopeProperty,
          path: { type: "string" },
        },
        required: ["path"],
      }),
      execute: async ({
        scope,
        path,
      }): Promise<string | ImageToolOutput | FileToolOutput> => {
        const result = await files(scope).read(path)
        if (!result.ok) return `Error: ${result.error}`
        const { entry, bytes } = result.value
        const size = formatFileSize(entry.size)
        if (isTextMediaType(entry.mediaType)) {
          const text = new TextDecoder().decode(bytes)
          if (text.length <= READ_TEXT_MAX_CHARS) return text
          return `${text.slice(0, READ_TEXT_MAX_CHARS)}\n\n[Cut off at ${READ_TEXT_MAX_CHARS} of ${text.length} characters.]`
        }
        const data = Buffer.from(bytes).toString("base64")
        if (MODEL_IMAGE_TYPES.has(entry.mediaType)) {
          if (bytes.byteLength > IMAGE_MAX_BYTES) {
            return `Error: ${entry.path} is ${size}, too big to view (the most is 5 MB).`
          }
          return {
            kind: "image",
            caption: `${entry.path} (${size}, ${entry.mediaType})`,
            data,
            mediaType: entry.mediaType,
          }
        }
        if (entry.mediaType === "application/pdf") {
          return {
            kind: "file",
            caption: `${entry.path} (${size}, PDF)`,
            data,
            mediaType: entry.mediaType,
            filename: baseName(entry.path),
          }
        }
        return `${entry.path} is a ${size} ${entry.mediaType} file, which can't be shown as text, an image or a PDF.`
      },
      toModelOutput: imageModelOutput,
    }),

    save_file: tool({
      description: [
        "Save a file to the canvas's saved files, where later chats on this canvas can open it. Use it for a result worth keeping that doesn't belong on the canvas or in the repository: research notes, a reference image, a list to come back to. Saving to a path that exists replaces that file; folders in the path are made as needed.",
        ctx.readSource
          ? "Pass the text as `content`, or a file in your sandbox as `source_path` for an image, a PDF or anything else that isn't text."
          : "Pass the text as `content`.",
      ].join(" "),
      inputSchema: jsonSchema<
        Scope & {
          path: string
          content?: string
          source_path?: string
          media_type?: string
        }
      >({
        type: "object",
        properties: {
          scope: scopeProperty,
          path: {
            type: "string",
            description:
              "Where to save it, folders joined by `/`, e.g. `research/pricing.md`.",
          },
          content: { type: "string" },
          ...sourceProperty,
          media_type: {
            type: "string",
            description: "Its media type, when the extension doesn't say.",
          },
        },
        required: ["path"],
      }),
      execute: async ({ scope, path, content, source_path, media_type }) => {
        let bytes: Uint8Array
        let fallbackMediaType: string
        if (source_path !== undefined && ctx.readSource) {
          if (content !== undefined) {
            return "Error: pass `content` or `source_path`, not both."
          }
          const read = await ctx.readSource(source_path)
          if (!read) return `Error: no file at ${source_path}.`
          bytes = read
          fallbackMediaType = "application/octet-stream"
        } else if (content !== undefined) {
          bytes = new TextEncoder().encode(content)
          fallbackMediaType = "text/plain"
        } else {
          return ctx.readSource
            ? "Error: pass the file's `content` or its `source_path`."
            : "Error: pass the file's `content`."
        }
        const result = await files(scope).save({
          path,
          bytes,
          mediaType: media_type,
          fallbackMediaType,
          author,
        })
        if (!result.ok) return `Error: ${result.error}`
        const { entry, replaced } = result.value
        return `${replaced ? "Replaced" : "Saved"} ${entry.path} (${formatFileSize(entry.size)}, ${entry.mediaType}).`
      },
    }),

    move_saved_file: tool({
      description:
        "Move or rename one of the canvas's saved files, or a folder with everything in it. Folders in the new path are made as needed; nothing may already be at it.",
      inputSchema: jsonSchema<Scope & { path: string; to: string }>({
        type: "object",
        properties: {
          scope: scopeProperty,
          path: { type: "string", description: "What to move." },
          to: { type: "string", description: "Its new path." },
        },
        required: ["path", "to"],
      }),
      execute: async ({ scope, path, to }) => {
        const result = await files(scope).move(path, to)
        if (!result.ok) return `Error: ${result.error}`
        const { kind, moved } = result.value
        return kind === "folder"
          ? `Moved the folder to ${to} with ${moved - 1} item${moved === 2 ? "" : "s"} in it.`
          : `Moved to ${to}.`
      },
    }),

    delete_saved_file: tool({
      description:
        "Delete one of the canvas's saved files, or a folder with everything in it. Delete files you made that are wrong or out of date, so later chats aren't misled. It can't be undone.",
      inputSchema: jsonSchema<Scope & { path: string }>({
        type: "object",
        properties: {
          scope: scopeProperty,
          path: { type: "string" },
        },
        required: ["path"],
      }),
      execute: async ({ scope, path }) => {
        const result = await files(scope).remove(path)
        if (!result.ok) return `Error: ${result.error}`
        const { kind, removed } = result.value
        return kind === "folder"
          ? `Deleted the folder and ${removed - 1} item${removed === 2 ? "" : "s"} in it.`
          : "Deleted."
      },
    }),

    make_saved_folder: tool({
      description:
        "Make a folder in the canvas's saved files, to keep related files together. Any folder above it is made too.",
      inputSchema: jsonSchema<Scope & { path: string }>({
        type: "object",
        properties: {
          scope: scopeProperty,
          path: { type: "string" },
        },
        required: ["path"],
      }),
      execute: async ({ scope, path }) => {
        const result = await files(scope).makeFolder(path, author)
        if (!result.ok) return `Error: ${result.error}`
        return result.value.created
          ? "Made the folder."
          : "That folder already exists."
      },
    }),
  }
  // Saved files sit outside the repository and the canvas, so a harness
  // never needs to ask before reading them; deleting one can't be undone.
  return annotateTools(tools, {
    list_saved_files: { readOnlyHint: true, openWorldHint: false },
    read_saved_file: { readOnlyHint: true, openWorldHint: false },
    save_file: { destructiveHint: false, openWorldHint: false },
    move_saved_file: { destructiveHint: false, openWorldHint: false },
    delete_saved_file: { destructiveHint: true, openWorldHint: false },
    make_saved_folder: { destructiveHint: false, openWorldHint: false },
  })
}

export type FileTools = ReturnType<typeof buildFileTools>
