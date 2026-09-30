import "server-only"

import { tool, jsonSchema } from "ai"
import type { RoomDoc } from "@/lib/room-access"
import type { McpToolAnnotations } from "@/lib/mcp/tool-server"
import { CODE_READ_TOOL_ANNOTATIONS } from "@/lib/agent/code-read-tools"
import { FRAME_READ_TOOL_ANNOTATIONS } from "@/lib/agent/frame-read-tools"
import {
  documentFragment,
  fragmentBodyToPlainText,
  replaceFragmentBodyPreservingTitle,
  setFragmentTitle,
} from "@/lib/yjs/fragment-text"

/**
 * *Write* tools for a chat session targeting a document layer — replace
 * body, append, retitle. The matching read tool (`read_document`) is no
 * longer kind-private; it lives in `layer-read-tools.ts` and is mixed into
 * every chat target's toolset so any chat can follow `@<title>` mentions.
 *
 * Every mutation goes through the turn's `room.mutateDoc` so concurrent edits from the
 * agent and the human sit on the same Yjs CRDT — the human's keystrokes
 * never get clobbered, and a write applied while the user is typing just
 * merges in.
 */
export interface MarkdownLayerToolContext {
  /** The turn's Room, opened through Room Access by the agent route. */
  room: RoomDoc
  /** The document the chat is targeting. */
  markdownLayerId: string
}

export function buildMarkdownLayerTools(ctx: MarkdownLayerToolContext) {
  return {
    replace_document_body: tool({
      description:
        "Replace the body of the targeted document, below the title. The `content` is parsed as CommonMark markdown — headings (`##`, `###`), bullet/ordered lists, blockquotes, code blocks, and inline marks (`**bold**`, `*italic*`, `` `code` ``, `[link](url)`) all work. The document title is set separately, don't repeat it as a top-level `#` heading. Use this when you've redrafted the document; for incremental edits prefer `append_to_document_body`. To change the title, use `set_document_title`.",
      inputSchema: jsonSchema<{ content: string }>({
        type: "object",
        properties: { content: { type: "string" } },
        required: ["content"],
      }),
      execute: async (input) => {
        const content = (input as { content: string }).content
        await ctx.room.mutateDoc(({ doc, markdownLayers }) => {
          if (!markdownLayers.get(ctx.markdownLayerId)) return
          const fragment = documentFragment(doc, ctx.markdownLayerId)
          replaceFragmentBodyPreservingTitle(fragment, content)
        })
        return `Replaced document body (${content.length} characters).`
      },
    }),

    append_to_document_body: tool({
      description:
        "Append a block of text to the end of the targeted document's body. Use the same lightweight markdown syntax as `replace_document_body`. Keeps everything already in the document, but flattens inline marks already present in it — the appended text keeps its own marks. Use `replace_document_body` when the document's existing marks must survive.",
      inputSchema: jsonSchema<{ content: string }>({
        type: "object",
        properties: { content: { type: "string" } },
        required: ["content"],
      }),
      execute: async (input) => {
        const content = (input as { content: string }).content
        await ctx.room.mutateDoc(({ doc, markdownLayers }) => {
          if (!markdownLayers.get(ctx.markdownLayerId)) return
          const fragment = documentFragment(doc, ctx.markdownLayerId)
          // Re-derive the existing body (excluding the title) and concatenate.
          // Cheap on small docs and avoids us needing a precise "insert at
          // end" API for the parser; round-trip loses inline marks but
          // preserves the title verbatim.
          const existingBody = fragmentBodyToPlainText(fragment)
          const next =
            existingBody.length > 0 ? `${existingBody}\n\n${content}` : content
          replaceFragmentBodyPreservingTitle(fragment, next)
        })
        return `Appended ${content.length} characters to the document.`
      },
    }),

    set_document_title: tool({
      description:
        "Update the targeted document's title. Use a short, descriptive heading — this is what shows up at the top of the document, in the sidebar, and the @-mention popover.",
      inputSchema: jsonSchema<{ title: string }>({
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      }),
      execute: async (input) => {
        const title = (input as { title: string }).title
        await ctx.room.mutateDoc(({ doc, markdownLayers }) => {
          if (!markdownLayers.get(ctx.markdownLayerId)) return
          // The title heading inside the body is the source of truth — write
          // there and mirror onto the cached `title` field so non-editor
          // consumers (sidebar labels, mention popover) update immediately.
          setFragmentTitle(documentFragment(doc, ctx.markdownLayerId), title)
          markdownLayers.update(ctx.markdownLayerId, { title })
        })
        return `Title set to "${title}".`
      },
    }),
  }
}

export type DocumentTools = ReturnType<typeof buildMarkdownLayerTools>

/**
 * MCP hints for a document chat's tools on a desktop harness: its own
 * document edits (undoable in the editor, never destructive), the shared
 * document reader, its code reads and its frame reads.
 */
export const MARKDOWN_LAYER_TOOL_ANNOTATIONS: Readonly<
  Record<string, McpToolAnnotations>
> = {
  replace_document_body: { destructiveHint: false, openWorldHint: false },
  append_to_document_body: { destructiveHint: false, openWorldHint: false },
  set_document_title: { destructiveHint: false, openWorldHint: false },
  read_document: { readOnlyHint: true, openWorldHint: false },
  ...CODE_READ_TOOL_ANNOTATIONS,
  ...FRAME_READ_TOOL_ANNOTATIONS,
}
