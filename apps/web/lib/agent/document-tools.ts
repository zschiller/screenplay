import "server-only"

import { tool, jsonSchema } from "ai"
import { mutateRoomDoc, readRoomDoc } from "@/lib/yjs/server"
import {
  fragmentToPlainText,
  writeMarkdownToFragment,
} from "@/lib/yjs/fragment-text"

/**
 * Tools available to a chat session that targets a document layer (rather
 * than an agent's sandbox). The toolset is intentionally small and focused
 * on prose editing — read, replace, append, retitle. Future kinds of layer
 * targets (sticky notes, embeds, …) can register their own tool factories
 * alongside this one.
 *
 * Every mutation goes through `mutateRoomDoc` so concurrent edits from the
 * agent and the human sit on the same Yjs CRDT — the human's keystrokes
 * never get clobbered, and a write applied while the user is typing just
 * merges in.
 */
export interface DocumentToolContext {
  roomId: string
  /** The document the chat is targeting. Tool calls without an explicit
   *  `id` argument default to it. */
  documentId: string
}

export function buildDocumentTools(ctx: DocumentToolContext) {
  return {
    read_document: tool({
      description:
        "Read the body of a document on the canvas. With no `id`, returns the targeted document. Use this to confirm current contents before rewriting, or to pull in another document's body when the user @-mentions one.",
      inputSchema: jsonSchema<{ id?: string }>({
        type: "object",
        properties: { id: { type: "string" } },
      }),
      execute: async (input) => {
        const id = (input as { id?: string }).id ?? ctx.documentId
        const result = await readRoomDoc(ctx.roomId, ({ documentLayers, doc }) => {
          const layer = documentLayers.get(id)
          if (!layer) return null
          const fragment = doc.getXmlFragment(`doc-${id}`)
          return {
            id,
            title: layer.title,
            body: fragmentToPlainText(fragment),
          }
        })
        if (!result) return `Document not found: ${id}`
        return [
          `# ${result.title || "Untitled"}`,
          "",
          result.body || "(empty)",
        ].join("\n")
      },
    }),

    replace_document_body: tool({
      description:
        "Replace the entire body of the targeted document. The `content` should be the full new body — paragraphs separated by blank lines, headings prefixed with `#`/`##`/`###`, list items prefixed with `- `. Marks like bold/italic are not preserved; emit them as plain text. Use this when you've redrafted the document; for incremental edits prefer `append_to_document_body`.",
      inputSchema: jsonSchema<{ content: string }>({
        type: "object",
        properties: { content: { type: "string" } },
        required: ["content"],
      }),
      execute: async (input) => {
        const content = (input as { content: string }).content
        await mutateRoomDoc(ctx.roomId, ({ doc, documentLayers }) => {
          if (!documentLayers.get(ctx.documentId)) return
          const fragment = doc.getXmlFragment(`doc-${ctx.documentId}`)
          writeMarkdownToFragment(fragment, content)
        })
        return `Replaced document body (${content.length} characters).`
      },
    }),

    append_to_document_body: tool({
      description:
        "Append a block of text to the end of the targeted document's body. Use the same lightweight markdown syntax as `replace_document_body`. Preserves everything already in the document.",
      inputSchema: jsonSchema<{ content: string }>({
        type: "object",
        properties: { content: { type: "string" } },
        required: ["content"],
      }),
      execute: async (input) => {
        const content = (input as { content: string }).content
        await mutateRoomDoc(ctx.roomId, ({ doc, documentLayers }) => {
          if (!documentLayers.get(ctx.documentId)) return
          const fragment = doc.getXmlFragment(`doc-${ctx.documentId}`)
          // Re-derive the existing body and concatenate. Cheap on small
          // docs and avoids us needing a precise "insert at end" API for
          // the parser; the round-trip loses nothing the parser can't
          // already render.
          const existing = fragmentToPlainText(fragment)
          const next = existing.length > 0 ? `${existing}\n\n${content}` : content
          writeMarkdownToFragment(fragment, next)
        })
        return `Appended ${content.length} characters to the document.`
      },
    }),

    set_document_title: tool({
      description:
        "Update the targeted document's title. Use a short, descriptive heading — this is what shows up in the canvas tile, the sidebar, and the @-mention popover.",
      inputSchema: jsonSchema<{ title: string }>({
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      }),
      execute: async (input) => {
        const title = (input as { title: string }).title
        await mutateRoomDoc(ctx.roomId, ({ documentLayers }) => {
          if (!documentLayers.get(ctx.documentId)) return
          documentLayers.update(ctx.documentId, { title })
        })
        return `Title set to "${title}".`
      },
    }),
  }
}

export type DocumentTools = ReturnType<typeof buildDocumentTools>
