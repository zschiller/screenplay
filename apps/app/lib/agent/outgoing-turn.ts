import type { ChatQuote } from "@/lib/chat-quote-store"
import { formatQuoteForChat } from "@/lib/document-comments"
import {
  buildAttachmentsFooter,
  buildCanvasViewFooter,
  buildDraftedOnFooter,
  buildReferencedDocsFooter,
  buildTargetedElementsFooter,
  stripDrawnBoxFooter,
  type CanvasView,
  type MessageAttachment,
  type ReferencedDoc,
  type TargetedElement,
} from "@/lib/agent/message-markers"
import type { UserTurn } from "@/lib/agent/user-turn"

/**
 * Outgoing Turn (#1497): the one place a message this client sends becomes
 * both its wire text and the turn the chat shows for it, the send-side mirror
 * of the {@link projectUserTurn} projection. Every hidden marker a send adds
 * (the Composer's footers, the Quote in chat quote, the Canvas view, the
 * Mockup a page drafted it on) is
 * appended here and nowhere else, so a new one is a single edit beside its
 * stripper in `parseUserMessage`, and `turn` is always exactly what the
 * server's echo will project from `wire`.
 */
export interface OutgoingTurnParts {
  /**
   * What the user wrote, with its inline `[skill: …]`, `[@…](mention:…)` and
   * `[element: …](element:…)` tokens.
   */
  message: string
  /** The `@`-mentioned Layers, for the `Referenced documents:` footer. */
  referencedDocs?: ReferencedDoc[]
  /** The picked preview elements, for the `Targeted elements:` footer. */
  targetedElements?: TargetedElement[]
  /**
   * Files attached to the message (#1525), already saved in Canvas Files,
   * for the `Attached files:` footer and the message's chips.
   */
  attachments?: MessageAttachment[]
  /** A passage quoted by Quote in chat (#1243): it leads the body. */
  quote?: ChatQuote | null
  /**
   * The sender's selection and screen when they sent it (#1414), for the
   * `Canvas view:` footer only the model reads.
   */
  canvasView?: CanvasView | null
  /**
   * The Mockup whose page drafted the message (#1645), for the
   * `Drafted on mockup:` footer only the model reads.
   */
  draftedOn?: { id: string; title: string } | null
}

export interface OutgoingTurn {
  /** The text as posted to the stream route. */
  wire: string
  /** What the message shows: `projectUserTurn(wire)`, built from the parts. */
  turn: UserTurn
}

export function buildOutgoingTurn({
  message,
  referencedDocs = [],
  targetedElements = [],
  attachments = [],
  quote,
  canvasView,
  draftedOn,
}: OutgoingTurnParts): OutgoingTurn {
  const body = quote ? `${formatQuoteForChat(quote)}\n\n${message}` : message
  return {
    wire:
      body +
      buildAttachmentsFooter(attachments) +
      buildReferencedDocsFooter(referencedDocs) +
      buildTargetedElementsFooter(targetedElements) +
      buildCanvasViewFooter(canvasView ?? null) +
      buildDraftedOnFooter(draftedOn ?? null),
    turn: {
      // A drawn box's ask carries its footer in the message itself.
      body: stripDrawnBoxFooter(body),
      ...(targetedElements.length > 0 ? { targetedElements } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    },
  }
}
