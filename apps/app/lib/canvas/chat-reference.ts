import type { SendMessageOptions } from "@/lib/chat-store"
import { formatQuoteForChat } from "@/lib/document-comments"
import type {
  BranchData,
  ChatSessionData,
  IframeLayerData,
  MarkdownLayerData,
} from "@/lib/types"

/**
 * Element Reference — the pure decision behind the "anchor an element / text
 * span and Send to agent" reference path (`apps/app/CONTEXT.md`,
 * "Element Reference"). It is the sibling of `lib/chat/chat-target` and
 * `lib/chat/tab-pool`: given a send-to-chat context (the anchored element or doc
 * selection, plus the live agent / layer / chat snapshots) and the typed note,
 * it produces the resolved target, the new Chat Session spec, the formatted
 * message body, and the `sendMessage` arguments. The Element Reference
 * controller (`useElementReference`, PRD #570) applies that decision — create
 * the session, select the target through the Chat-Target controller, and call
 * `chatStore.sendMessage`. React-free, Yjs-free, tested against plain values.
 *
 * Two routing rules are pinned here:
 *
 * 1. A **frame element** routes to the agent that owns the frame (the frame's
 *    branch) — *not* whatever chat is currently focused — and tags the message
 *    with the picked route + element selector.
 * 2. A **document selection** routes to that document's own chat target and
 *    prepends the quoted span + line range (via {@link formatQuoteForChat}).
 *
 * In both cases the reference always opens a **fresh** chat; a missing branch or
 * sandbox yields no send.
 */

/**
 * A send-to-chat context: the element or doc-text span the user anchored.
 * Structurally the `SendToChatContext` the comment composer emits — `documentId`
 * (or `iframeLayerId` resolving to a doc layer) marks a document selection;
 * otherwise `iframeLayerId` names the frame the element was picked in.
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
export type ReferenceSelection =
  | { kind: "document"; documentId: string; chatId: string }
  | { kind: "agent"; agentId: string; chatId: string }

/**
 * The resolved reference: the Chat Session to create, which target to select,
 * and the `sendMessage` arguments (callbacks are wired by the controller). Or
 * `{ kind: "none" }` when the target can't be resolved — a frame element whose
 * owning agent has no sandbox / branch.
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

/**
 * Format a frame-element reference: the note plus the route the element was
 * picked on and, when known, the element selector — the context the agent needs
 * to act on it.
 */
export function formatFrameReference(
  note: string,
  route: string,
  selector?: string | null
): string {
  const elementLine = selector ? `\nElement: \`${selector}\`` : ""
  return `${note}\n\nRoute: \`${route}\`${elementLine}`
}

export interface ResolveReferenceInput {
  note: string
  ctx: ReferenceContext
  /** Plain runtime values injected so the decision stays deterministic. */
  roomId: string
  chatId: string
  createdAt: number
  /** Live snapshots the routing reads. */
  agents: BranchData[]
  iframeLayers: IframeLayerData[]
  markdownLayers: MarkdownLayerData[]
  chatSessions: ChatSessionData[]
}

/**
 * Resolve a send-to-chat context + note into the reference to send. The
 * document case takes precedence: comment-mode hit-tests against a layout set
 * that includes both frames and document layers, so `ctx.iframeLayerId` may name
 * either kind — a match in `markdownLayers` is a document.
 */
export function resolveReference(
  input: ResolveReferenceInput
): ReferenceDecision {
  const {
    note,
    ctx,
    roomId,
    chatId,
    createdAt,
    agents,
    iframeLayers,
    markdownLayers,
    chatSessions,
  } = input

  // Document-layer reference: pivot to that doc's chat and send the note,
  // prepended with the quoted span + line range for a specific selection.
  const docId = ctx.documentId ?? ctx.iframeLayerId ?? null
  const docLayer = docId
    ? markdownLayers.find((d) => d.id === docId)
    : undefined
  if (docLayer) {
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

  // Frame-element reference: route to the agent that owns the frame the element
  // was picked in — not the focused chat — and always in a fresh chat.
  const iframeLayer = ctx.iframeLayerId
    ? iframeLayers.find((a) => a.id === ctx.iframeLayerId)
    : undefined
  const agent = iframeLayer?.branchId
    ? agents.find((a) => a.id === iframeLayer.branchId)
    : null
  if (!agent?.sandboxName || !agent.ref) return { kind: "none" }

  const route = iframeLayer?.route || "/"
  const message = formatFrameReference(note, route, ctx.selector)
  const isFirstChat = !chatSessions.some(
    (c) => c.branchId === agent.id && c.id !== chatId
  )
  return {
    kind: "send",
    session: {
      id: chatId,
      branchId: agent.id,
      label: "Untitled",
      createdAt,
    },
    isFirstChat,
    select: { kind: "agent", agentId: agent.id, chatId },
    send: {
      roomId,
      chatId,
      sandboxName: agent.sandboxName,
      branch: agent.ref,
      message,
      isFirstChat,
      autoNamedBranch: agent.autoNamedBranch,
    },
  }
}
