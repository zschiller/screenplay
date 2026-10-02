import "server-only"

import { tool, jsonSchema } from "ai"
import type { RoomDoc } from "@/lib/room-access"
import type { McpToolAnnotations } from "@/lib/mcp/tool-server"
import { createCanvasOps } from "@/lib/canvas/ops"
import { getGroupMembers, placeNewGroupBeside } from "@/lib/canvas/layout"
import { sizedLayersOf } from "@/lib/canvas/sized-layers"
import { createRoomCollections, type RoomCollections } from "@/lib/yjs/schema"
import {
  documentFragment,
  fragmentBodyToPlainText,
  replaceFragmentBodyPreservingTitle,
  setFragmentTitle,
} from "@/lib/yjs/fragment-text"

/**
 * A chat's Document tools (#1314): it creates Documents, and edits the ones it
 * made. A Document records the chat that made it (`ownerChatId`), so the edit
 * tools refuse any other: a Document someone made by hand, or another chat's,
 * is theirs to change. Reading any Document is the shared `read_document`
 * (`layer-read-tools.ts`), which every chat has.
 *
 * Every mutation goes through the turn's `room.mutateDoc` so concurrent edits
 * from the agent and a person sit on the same Yjs CRDT — the person's
 * keystrokes never get clobbered, and a write applied while they type merges
 * in.
 */
export interface DocumentToolContext {
  /** The turn's Room, opened through Room Access by the agent route. */
  room: RoomDoc
  /** The chat the tools act for: what its new Documents record as their owner. */
  chatId: string
}

/** A new Document's size, as a click with the Document tool makes it. */
const DOCUMENT_SIZE = { width: 480, height: 640 }

export function buildDocumentTools(ctx: DocumentToolContext) {
  /**
   * One edit of a Document this chat owns. Reads through a fresh collection
   * view: nothing observes a server doc, so a cached one can read stale.
   */
  const editOwned = (
    documentId: string,
    edit: (c: RoomCollections) => string
  ): Promise<string> =>
    ctx.room.mutateDoc(({ doc }) => {
      const c = createRoomCollections(doc)
      const layer = c.markdownLayers.get(documentId)
      if (!layer) return `Error: no document ${documentId}.`
      if (layer.ownerChatId !== ctx.chatId) {
        return `Error: "${layer.title || "Untitled"}" wasn't made by this chat, so you can read it but not change it.`
      }
      return edit(c)
    })

  return {
    create_document: tool({
      description:
        "Create a Document on the canvas, beside this chat's other frames and Documents. It is yours: only you can edit it with these tools, and the person sees your name on it. `content` is its body as CommonMark markdown (don't repeat the title as a `#` heading). Returns its id.",
      inputSchema: jsonSchema<{ title?: string; content?: string }>({
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
        },
      }),
      execute: async ({ title, content }) =>
        ctx.room.mutateDoc(({ doc }) => {
          const c = createRoomCollections(doc)
          const anchor = placeNewGroupBeside(
            c.iframeLayerGroups.toArray(),
            c.iframeLayers.toArray(),
            sizedLayersOf(c),
            chatGroups(c, ctx.chatId),
            DOCUMENT_SIZE.width,
            DOCUMENT_SIZE.height
          )
          const ops = createCanvasOps(c)
          let docId = ""
          ops.batch(() => {
            docId = ops.createDocument(anchor, DOCUMENT_SIZE, {
              ownerChatId: ctx.chatId,
            }).docId
            if (title) ops.renameDocument(docId, title)
            if (content) {
              replaceFragmentBodyPreservingTitle(
                documentFragment(doc, docId),
                content
              )
            }
          })
          return `Created document "${title || "Untitled"}" (id ${docId}).`
        }),
    }),

    replace_document_body: tool({
      description:
        "Replace the body of a Document you made, below its title. The `content` is parsed as CommonMark markdown — headings (`##`, `###`), bullet/ordered lists, blockquotes, code blocks, and inline marks (`**bold**`, `*italic*`, `` `code` ``, `[link](url)`) all work. The title is set separately; don't repeat it as a top-level `#` heading. Use this when you've redrafted the Document; for incremental edits prefer `append_to_document_body`.",
      inputSchema: jsonSchema<{ document_id: string; content: string }>({
        type: "object",
        properties: {
          document_id: { type: "string" },
          content: { type: "string" },
        },
        required: ["document_id", "content"],
      }),
      execute: async ({ document_id, content }) =>
        editOwned(document_id, (c) => {
          replaceFragmentBodyPreservingTitle(
            documentFragment(c.doc, document_id),
            content
          )
          return `Replaced document body (${content.length} characters).`
        }),
    }),

    append_to_document_body: tool({
      description:
        "Append a block of text to the end of a Document you made. Use the same markdown as `replace_document_body`. Keeps everything already in the Document, but flattens inline marks already present in it — the appended text keeps its own marks. Use `replace_document_body` when the Document's existing marks must survive.",
      inputSchema: jsonSchema<{ document_id: string; content: string }>({
        type: "object",
        properties: {
          document_id: { type: "string" },
          content: { type: "string" },
        },
        required: ["document_id", "content"],
      }),
      execute: async ({ document_id, content }) =>
        editOwned(document_id, (c) => {
          const fragment = documentFragment(c.doc, document_id)
          // Re-derive the existing body (excluding the title) and concatenate.
          // Cheap on small docs and avoids needing a precise "insert at end"
          // API for the parser; the round trip loses inline marks but keeps
          // the title verbatim.
          const existingBody = fragmentBodyToPlainText(fragment)
          const next =
            existingBody.length > 0 ? `${existingBody}\n\n${content}` : content
          replaceFragmentBodyPreservingTitle(fragment, next)
          return `Appended ${content.length} characters to the document.`
        }),
    }),

    set_document_title: tool({
      description:
        "Retitle a Document you made. Use a short, descriptive heading — it shows at the top of the Document, in the sidebar, and in the @-mention list.",
      inputSchema: jsonSchema<{ document_id: string; title: string }>({
        type: "object",
        properties: {
          document_id: { type: "string" },
          title: { type: "string" },
        },
        required: ["document_id", "title"],
      }),
      execute: async ({ document_id, title }) =>
        editOwned(document_id, (c) => {
          // The title heading inside the body is the source of truth; the
          // verb mirrors it onto the cached `title` field.
          setFragmentTitle(documentFragment(c.doc, document_id), title)
          c.markdownLayers.update(document_id, { title })
          return `Title set to "${title}".`
        }),
    }),
  }
}

/**
 * The Groups holding a chat's layers, which its new Documents land beside:
 * its own Documents, and the frames showing its Workspace.
 */
function chatGroups(c: RoomCollections, chatId: string): Set<string> {
  const branchId = c.chatSessions.get(chatId)?.branchId
  const ids = new Set<string>()
  for (const g of c.iframeLayerGroups.toArray()) {
    const mine = getGroupMembers(g).some((m) =>
      m.kind === "markdown-layer"
        ? c.markdownLayers.get(m.id)?.ownerChatId === chatId
        : m.kind === "mockup-layer"
          ? c.mockupLayers.get(m.id)?.ownerChatId === chatId
          : !!branchId && c.iframeLayers.get(m.id)?.branchId === branchId
    )
    if (mine) ids.add(g.id)
  }
  return ids
}

export type DocumentTools = ReturnType<typeof buildDocumentTools>

/**
 * MCP hints for a chat's Document tools on a desktop harness: its own
 * Document edits (undoable in the editor, never destructive) and the shared
 * Document reader.
 */
export const DOCUMENT_TOOL_ANNOTATIONS: Readonly<
  Record<string, McpToolAnnotations>
> = {
  create_document: { destructiveHint: false, openWorldHint: false },
  replace_document_body: { destructiveHint: false, openWorldHint: false },
  append_to_document_body: { destructiveHint: false, openWorldHint: false },
  set_document_title: { destructiveHint: false, openWorldHint: false },
  read_document: { readOnlyHint: true, openWorldHint: false },
}
