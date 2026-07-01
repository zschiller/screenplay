import type { SendMessageOptions } from "@/lib/chat-store"
import { formatQuoteForChat } from "@/lib/document-comments"
import type { ChatSessionData, MarkdownLayerData } from "@/lib/types"

/**
 * Element Reference — the pure decision behind the "anchor a doc text span and
 * Send to agent" reference path (`apps/app/CONTEXT.md`, "Element Reference"). It
 * is the sibling of `lib/chat/chat-target` and `lib/chat/tab-pool`: given a
 * send-to-chat context (the anchored doc selection plus the live doc / chat
 * snapshots) and the typed note, it produces the resolved target, the new Chat
 * Session spec, the formatted message body, and the `sendMessage` arguments. The
 * Element Reference controller (`useElementReference`, PRD #570) applies that
 * decision — create the session, select the target through the Chat-Target
 * controller, and call `chatStore.sendMessage`. React-free, Yjs-free, tested
 * against plain values.
 *
 * The one routing rule pinned here: a **document selection** routes to that
 * document's own chat target and prepends the quoted span + line range (via
 * {@link formatQuoteForChat}), always in a **fresh** chat. The old frame-element
 * → owning-agent route was retired in favour of the composer token flow (#618);
 * a context that names no document yields no send.
 */

/**
 * A send-to-chat context: the doc-text span the user anchored. Structurally the
 * `SendToChatContext` the comment composer emits — `documentId` (or
 * `iframeLayerId` resolving to a doc layer) marks the document.
 */
export interface ReferenceContext {
  iframeLayerId?: string | null
  selector?: string | null
  documentId?: string | null
  quotedText?: string | null
  lineFrom?: number | null
  lineTo?: number | null
}

/** Which Chat Target the controller selects after creating the fresh chat. */
export type ReferenceSelection = {
  kind: "document"
  documentId: string
  chatId: string
}

/**
 * The resolved reference: the Chat Session to create, which target to select,
 * and the `sendMessage` arguments (callbacks are wired by the controller). Or
 * `{ kind: "none" }` when the context names no resolvable document.
 */
export type ReferenceDecision =
  | { kind: "none" }
  | {
      kind: "send"
      session: ChatSessionData
      isFirstChat: boolean
      select: ReferenceSelection
      send: Omit<SendMessageOptions, "onBranchRename" | "onChatRename">
    }

/** Whether the context carries a resolvable document text selection. */
function hasQuotedSelection(ctx: ReferenceContext): ctx is ReferenceContext & {
  quotedText: string
  lineFrom: number
  lineTo: number
} {
  return (
    ctx.quotedText !== null &&
    ctx.quotedText !== undefined &&
    ctx.lineFrom !== null &&
    ctx.lineFrom !== undefined &&
    ctx.lineTo !== null &&
    ctx.lineTo !== undefined
  )
}

/**
 * Format a document-selection reference: the note, prepended with the quoted
 * span + line range when the user commented on a specific selection (else the
 * note as-is).
 */
export function formatDocumentReference(
  note: string,
  ctx: ReferenceContext,
  documentTitle: string | null
): string {
  if (!hasQuotedSelection(ctx)) return note
  const quote = formatQuoteForChat({
    quotedText: ctx.quotedText,
    lineFrom: ctx.lineFrom,
    lineTo: ctx.lineTo,
    documentTitle,
  })
  return `${quote}\n\n${note}`
}

export interface ResolveReferenceInput {
  note: string
  ctx: ReferenceContext
  /** Plain runtime values injected so the decision stays deterministic. */
  roomId: string
  chatId: string
  createdAt: number
  /** Live snapshots the routing reads. */
  markdownLayers: MarkdownLayerData[]
  chatSessions: ChatSessionData[]
}

/**
 * Resolve a send-to-chat context + note into the reference to send. Comment-mode
 * hit-tests against a layout set that includes both frames and document layers,
 * so `ctx.iframeLayerId` may name either kind — a match in `markdownLayers` is a
 * document, and only documents resolve to a send. A context that names no
 * document (a frame, whose element→agent route was retired for the composer
 * token flow, #618) yields `{ kind: "none" }`.
 */
export function resolveReference(
  input: ResolveReferenceInput
): ReferenceDecision {
  const { note, ctx, roomId, chatId, createdAt, markdownLayers, chatSessions } =
    input

  // Document-layer reference: pivot to that doc's chat and send the note,
  // prepended with the quoted span + line range for a specific selection.
  const docId = ctx.documentId ?? ctx.iframeLayerId ?? null
  const docLayer = docId
    ? markdownLayers.find((d) => d.id === docId)
    : undefined
  if (!docLayer) return { kind: "none" }

  const message = formatDocumentReference(note, ctx, docLayer.title || null)
  const isFirstChat = !chatSessions.some(
    (c) => c.markdownLayerId === docLayer.id && c.id !== chatId
  )
  return {
    kind: "send",
    session: {
      id: chatId,
      markdownLayerId: docLayer.id,
      label: "Untitled",
      createdAt,
    },
    isFirstChat,
    select: { kind: "document", documentId: docLayer.id, chatId },
    send: {
      roomId,
      chatId,
      markdownLayerId: docLayer.id,
      message,
      isFirstChat,
    },
  }
}
