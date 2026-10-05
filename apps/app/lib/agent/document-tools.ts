import "server-only"

import { tool, jsonSchema } from "ai"
import type { RoomDoc } from "@/lib/room-access"
import { annotateTools } from "@/lib/mcp/tool-server"
import { createCanvasOps } from "@/lib/canvas/ops"
import { getGroupMembers, placeNewGroupBeside } from "@/lib/canvas/layout"
import { sizedLayersOf } from "@/lib/canvas/sized-layers"
import { createRoomCollections, type RoomCollections } from "@/lib/yjs/schema"
import { editRight } from "@/lib/canvas/document-owner"
import { documentFragment, setFragmentTitle } from "@/lib/yjs/fragment-text"
import {
  appendDocumentMarkdown,
  writeDocumentMarkdown,
} from "@/lib/document-markdown"

/**
 * A chat's Document tools (#1314): it creates Documents, and edits the ones it
 * made. A Document records the chat that made it (`ownerChatId`), so the edit
 * tools refuse any other: a Document someone made by hand, or another chat's,
 * is theirs to change. Once the chat that made one is deleted, any chat may
 * edit it, and the first that does becomes its owner. Reading any Document is the shared `read_document`
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
   * One edit of a Document this chat owns, or claims because its chat was
   * deleted. Reads through a fresh collection view: nothing observes a server
   * doc, so a cached one can read stale.
   */
  const editOwned = (
    documentId: string,
    edit: (c: RoomCollections) => string
  ): Promise<string> =>
    ctx.room.mutateDoc(({ doc }) => {
      const c = createRoomCollections(doc)
      const layer = c.markdownLayers.get(documentId)
      if (!layer) return `Error: no document ${documentId}.`
      const right = editRight(
        layer.ownerChatId,
        ctx.chatId,
        (id) => !!c.chatSessions.get(id)
      )
      if (right === "theirs") {
        return `Error: "${layer.title || "Untitled"}" wasn’t made by this chat, so you can read it but not change it.`
      }
      let result = ""
      createCanvasOps(c).batch(() => {
        if (right === "claim") {
          c.markdownLayers.update(documentId, { ownerChatId: ctx.chatId })
        }
        result = edit(c)
      })
      return result
    })

  const tools = {
    create_document: tool({
      description:
        "Create a Document on the canvas, beside this chat’s other frames and Documents. It is yours: only you can edit it with these tools (until this chat is deleted), and the person sees your name on it. `content` is its body as CommonMark markdown (don’t repeat the title as a `#` heading). Returns its id.",
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
              writeDocumentMarkdown(documentFragment(doc, docId), content, {
                keepTitle: true,
              })
            }
          })
          return `Created document "${title || "Untitled"}" (id ${docId}).`
        }),
    }),

    replace_document_body: tool({
      description:
        "Replace the body of a Document you made (or one whose chat was deleted, which makes it yours), below its title. The `content` is parsed as CommonMark markdown — headings (`##`, `###`), bullet/ordered lists, blockquotes, code blocks, inline marks (`**bold**`, `*italic*`, `` `code` ``, `[link](url)`), images and mentions all work. A mention is `[@<name>](mention:<kind>:<id>)`, as `read_document` shows them, where kind is `document`, `chat` or `mockup`. An image is `![alt](path)` on its own line, where `path` is an image in the canvas’s saved files (`uploads/sketch.png`; wrap a path with spaces in `<…>`), and the Document shows it. The title is set separately; don’t repeat it as a top-level `#` heading. Use this when you’ve redrafted the Document; for incremental edits prefer `append_to_document_body`.",
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
          writeDocumentMarkdown(documentFragment(c.doc, document_id), content, {
            keepTitle: true,
          })
          return `Replaced document body (${content.length} characters).`
        }),
    }),

    append_to_document_body: tool({
      description:
        "Append a block of text to the end of a Document you made (or one whose chat was deleted, which makes it yours). Use the same markdown as `replace_document_body`. Everything already in the Document stays as it is.",
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
          appendDocumentMarkdown(documentFragment(c.doc, document_id), content)
          return `Appended ${content.length} characters to the document.`
        }),
    }),

    set_document_title: tool({
      description:
        "Retitle a Document you made (or one whose chat was deleted, which makes it yours). Use a short, descriptive heading — it shows at the top of the Document, in the sidebar, and in the @-mention list.",
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
  // MCP hints for a desktop harness: a chat's edits to its own Documents are
  // undoable in the editor, never destructive.
  return annotateTools(tools, {
    create_document: { destructiveHint: false, openWorldHint: false },
    replace_document_body: { destructiveHint: false, openWorldHint: false },
    append_to_document_body: { destructiveHint: false, openWorldHint: false },
    set_document_title: { destructiveHint: false, openWorldHint: false },
  })
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
