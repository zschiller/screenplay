import "server-only"

import { tool, jsonSchema } from "ai"
import { mutateRoomDoc, readRoomDoc } from "@/lib/yjs/server"
import {
  fragmentBodyToPlainText,
  replaceFragmentBodyPreservingTitle,
  setFragmentTitle,
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
            body: fragmentBodyToPlainText(fragment),
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
        "Replace the body of the targeted document, below the title. The `content` is parsed as CommonMark markdown — headings (`##`, `###`), bullet/ordered lists, blockquotes, code blocks, and inline marks (`**bold**`, `*italic*`, `` `code` ``, `[link](url)`) all work. The document title is set separately, don't repeat it as a top-level `#` heading. Use this when you've redrafted the document; for incremental edits prefer `append_to_document_body`. To change the title, use `set_document_title`.",
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
          replaceFragmentBodyPreservingTitle(fragment, content)
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
          // Re-derive the existing body (excluding the title) and concatenate.
          // Cheap on small docs and avoids us needing a precise "insert at
          // end" API for the parser; round-trip loses inline marks but
          // preserves the title verbatim.
          const existingBody = fragmentBodyToPlainText(fragment)
          const next = existingBody.length > 0
            ? `${existingBody}\n\n${content}`
            : content
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
        await mutateRoomDoc(ctx.roomId, ({ doc, documentLayers }) => {
          if (!documentLayers.get(ctx.documentId)) return
          // The title heading inside the body is the source of truth — write
          // there and mirror onto the cached `title` field so non-editor
          // consumers (sidebar labels, mention popover) update immediately.
          setFragmentTitle(doc.getXmlFragment(`doc-${ctx.documentId}`), title)
          documentLayers.update(ctx.documentId, { title })
        })
        return `Title set to "${title}".`
      },
    }),
  }
}

export type DocumentTools = ReturnType<typeof buildDocumentTools>
