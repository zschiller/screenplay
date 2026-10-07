import "server-only"

import { tool, jsonSchema } from "ai"
import type { RoomDoc } from "@/lib/room-access"
import { annotateTools } from "@/lib/mcp/tool-server"
import { createCanvasOps } from "@/lib/canvas/ops"
import { getGroupMembers, placeNewGroupBeside } from "@/lib/canvas/layout"
import { sizedLayersOf } from "@/lib/canvas/sized-layers"
import {
  DEFAULT_DOCUMENT_HEIGHT,
  DEFAULT_DOCUMENT_WIDTH,
} from "@/lib/constants"
import { createRoomCollections, type RoomCollections } from "@/lib/yjs/schema"
import { lastChangedBy } from "@/lib/canvas/layer-chat"
import { holdLayer } from "@/lib/agent/layer-hold"
import { layerFileOf, updateLayerFile } from "@/lib/yjs/file-views"
import {
  PAGE_PARAM_DESCRIPTION,
  pickLayerPage,
  type SenderPage,
} from "@/lib/agent/layer-page"
import { documentFragment, setFragmentTitle } from "@/lib/yjs/fragment-text"
import { mentionMarkdownNames } from "@/lib/mention-kinds"
import {
  appendDocumentMarkdown,
  writeDocumentMarkdown,
} from "@/lib/document-markdown"

/**
 * A chat's Document tools (#1314): it creates Documents, and edits any
 * Document on the canvas, whoever made it (#1724). Each create or edit records
 * the chat as the Document's `lastChangedByChatId`, which its Send to agent
 * and Quote in chat go to (`lib/canvas/layer-chat`), and holds the Document
 * for the rest of the turn: another chat's edit is refused meanwhile (#1725,
 * `layer-hold.ts`). Reading any Document is
 * the shared `read_document` (`layer-read-tools.ts`), which every chat has.
 *
 * Every mutation goes through the turn's `room.mutateDoc` so concurrent edits
 * from the agent and a person sit on the same Yjs CRDT — the person's
 * keystrokes never get clobbered, and a write applied while they type merges
 * in.
 */
export interface DocumentToolContext {
  /** The turn's Room, opened through Room Access by the agent route. */
  room: RoomDoc
  /** The chat the tools act for: what the Documents it changes record. */
  chatId: string
  /**
   * The page the turn's sender is on (#1842), where a new Document lands
   * unless it names one. Without it, the first page.
   */
  senderPage?: SenderPage
}

/** A new Document's size, as a click with the Document tool makes it. */
const DOCUMENT_SIZE = {
  width: DEFAULT_DOCUMENT_WIDTH,
  height: DEFAULT_DOCUMENT_HEIGHT,
}

export function buildDocumentTools(ctx: DocumentToolContext) {
  /**
   * One edit of a Document, recording this chat as its last changer, or the
   * refusal when another chat holds it (#1725). Reads
   * through a fresh collection view: nothing observes a server doc, so a
   * cached one can read stale.
   */
  const editDocument = (
    documentId: string,
    edit: (c: RoomCollections, fileId: string) => string
  ): Promise<string> =>
    ctx.room.mutateDoc(({ doc }) => {
      const c = createRoomCollections(doc)
      // The id may name a view or the file (#1883); the edit is the file's.
      const file = layerFileOf(c, documentId)
      if (file?.kind !== "document") return `Error: no document ${documentId}.`
      const refused = holdLayer(c, ctx.chatId, file.id)
      if (refused) return refused
      let result = ""
      createCanvasOps(c).batch(() => {
        updateLayerFile(c, documentId, { lastChangedByChatId: ctx.chatId })
        result = edit(c, file.id)
      })
      return result
    })

  const tools = {
    create_document: tool({
      description:
        "Create a Document. Every Document shows in your reply as a tile the person opens to read. With `place` it also goes on the canvas, on the sender’s page (or the page you name), beside this chat’s other frames and Documents there; without it, it stays in this chat until someone adds it to the canvas. Decide per Document: place one meant to sit beside the work on the canvas; leave off one that only answers this chat. Any chat can change it later, as you can change any Document that no other chat is changing right now. `content` is its body as CommonMark markdown (don’t repeat the title as a `#` heading). Returns its id, which add_to_canvas takes.",
      inputSchema: jsonSchema<{
        title?: string
        content?: string
        page?: string
        place: boolean
      }>({
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
          page: { type: "string", description: PAGE_PARAM_DESCRIPTION },
          place: {
            type: "boolean",
            description:
              "Whether to put it on the canvas now (true) or leave it in this chat until someone adds it (false)",
          },
        },
        required: ["place"],
      }),
      execute: async ({ title, content, page, place }) => {
        if (place === false) {
          return ctx.room.mutateDoc(({ doc }) => {
            const c = createRoomCollections(doc)
            const ops = createCanvasOps(c)
            let fileId = ""
            ops.batch(() => {
              fileId = ops.createFile({
                kind: "document",
                title,
                lastChangedByChatId: ctx.chatId,
              })
              holdLayer(c, ctx.chatId, fileId)
              if (content) {
                writeDocumentMarkdown(documentFragment(doc, fileId), content, {
                  keepTitle: true,
                })
              }
            })
            return `Created document "${title || "Untitled"}" (id ${fileId}), not on the canvas.`
          })
        }
        const senderPageId = await ctx.senderPage?.()
        return ctx.room.mutateDoc(({ doc }) => {
          const c = createRoomCollections(doc)
          const picked = pickLayerPage(c, page, senderPageId)
          if ("error" in picked) return picked.error
          const ops = createCanvasOps(c, { currentPageId: () => picked.pageId })
          // Placed beside the chat's Groups on that page, clear of the others
          // there: other pages' Groups don't share its plane.
          const anchor = placeNewGroupBeside(
            ops.groupsOnPage(),
            c.iframeLayers.toArray(),
            sizedLayersOf(c),
            chatGroups(c, ctx.chatId),
            DOCUMENT_SIZE.width,
            DOCUMENT_SIZE.height
          )
          let docId = ""
          ops.batch(() => {
            docId = ops.createDocument(anchor, DOCUMENT_SIZE, {
              lastChangedByChatId: ctx.chatId,
            }).docId
            holdLayer(c, ctx.chatId, docId)
            if (title) ops.renameDocument(docId, title)
            if (content) {
              writeDocumentMarkdown(documentFragment(doc, docId), content, {
                keepTitle: true,
              })
            }
          })
          return `Created document "${title || "Untitled"}" (id ${docId}).`
        })
      },
    }),

    replace_document_body: tool({
      description: `Replace the body of any Document, on the canvas or not, whichever chat or person made it, below its title. Another chat that’s changing it right now holds it until its turn ends: the edit is refused, so tell the person and carry on. Call \`start_editing\` with its id first, before you write the body. The \`content\` is parsed as CommonMark markdown — headings (\`##\`, \`###\`), bullet/ordered lists, blockquotes, code blocks, inline marks (\`**bold**\`, \`*italic*\`, \`\` \`code\` \`\`, \`[link](url)\`), images and mentions all work. A mention is \`[@<name>](mention:<kind>:<id>)\`, as \`read_document\` shows them, where kind is ${mentionMarkdownNames()}. An image is \`![alt](path)\` on its own line, where \`path\` is an image in the canvas’s saved files (\`uploads/sketch.png\`; wrap a path with spaces in \`<…>\`), and the Document shows it. The title is set separately; don’t repeat it as a top-level \`#\` heading. Use this when you’ve redrafted the Document; for incremental edits prefer \`append_to_document_body\`.`,
      inputSchema: jsonSchema<{ document_id: string; content: string }>({
        type: "object",
        properties: {
          document_id: { type: "string" },
          content: { type: "string" },
        },
        required: ["document_id", "content"],
      }),
      execute: async ({ document_id, content }) =>
        editDocument(document_id, (c, fileId) => {
          writeDocumentMarkdown(documentFragment(c.doc, fileId), content, {
            keepTitle: true,
          })
          return `Replaced document body (${content.length} characters).`
        }),
    }),

    append_to_document_body: tool({
      description:
        "Append a block of text to the end of any Document, on the canvas or not. Use the same markdown as `replace_document_body`. Everything already in the Document stays as it is. Call `start_editing` with its id first, before you write the block.",
      inputSchema: jsonSchema<{ document_id: string; content: string }>({
        type: "object",
        properties: {
          document_id: { type: "string" },
          content: { type: "string" },
        },
        required: ["document_id", "content"],
      }),
      execute: async ({ document_id, content }) =>
        editDocument(document_id, (c, fileId) => {
          appendDocumentMarkdown(documentFragment(c.doc, fileId), content)
          return `Appended ${content.length} characters to the document.`
        }),
    }),

    set_document_title: tool({
      description:
        "Retitle any Document, on the canvas or not. Use a short, descriptive heading — it shows at the top of the Document, in the sidebar, and in the @-mention list.",
      inputSchema: jsonSchema<{ document_id: string; title: string }>({
        type: "object",
        properties: {
          document_id: { type: "string" },
          title: { type: "string" },
        },
        required: ["document_id", "title"],
      }),
      execute: async ({ document_id, title }) =>
        editDocument(document_id, (c, fileId) => {
          // The title heading inside the body is the source of truth; the
          // verb mirrors it onto the file's cached `title` field.
          setFragmentTitle(documentFragment(c.doc, fileId), title)
          updateLayerFile(c, document_id, { title })
          return `Title set to "${title}".`
        }),
    }),
  }
  // MCP hints for a desktop harness: a chat's edits to Documents are
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
 * the Documents and Mockups it changed last, and the frames showing its
 * Workspace.
 */
function chatGroups(c: RoomCollections, chatId: string): Set<string> {
  const branchId = c.chatSessions.get(chatId)?.branchId
  const ids = new Set<string>()
  for (const g of c.iframeLayerGroups.toArray()) {
    const mine = getGroupMembers(g).some((m) =>
      m.kind === "markdown-layer"
        ? lastChangedByIs(c.markdownLayers.get(m.id), chatId)
        : m.kind === "mockup-layer"
          ? lastChangedByIs(c.mockupLayers.get(m.id), chatId)
          : !!branchId && c.iframeLayers.get(m.id)?.branchId === branchId
    )
    if (mine) ids.add(g.id)
  }
  return ids
}

function lastChangedByIs(
  layer: Parameters<typeof lastChangedBy>[0] | undefined,
  chatId: string
): boolean {
  return !!layer && lastChangedBy(layer) === chatId
}

export type DocumentTools = ReturnType<typeof buildDocumentTools>
