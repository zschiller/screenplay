/**
 * Quote in chat (#1243): a Document passage quoted into the composer of
 * whichever chat the panel is showing (`apps/app/CONTEXT.md`, "Chat Quote").
 *
 * The Document's selection toolbar lives on the Canvas; the composers live
 * deep in the chat panel. This singleton bridges them the way `targetingStore`
 * bridges element picking, but in the other direction: the Canvas asks, and
 * the **foreground** chat takes the quote. A chat registers as foreground while
 * it is the one on screen (the Coordinator, or the active chat tab of a
 * Workspace or Document); the newest registration wins. A quote asked for while
 * no chat is on screen (a terminal tab or the logs are showing) waits for the
 * next chat that comes to the foreground.
 *
 * A passage from a Document a chat made goes to that chat instead, wherever
 * the panel is ({@link quoteInto}, #1314); the Canvas brings it on screen.
 *
 * Each chat holds at most one quote: a second Quote in chat replaces it. The
 * quote rides the chat's next send and is cleared there ({@link take}).
 */

/** The passage a Quote in chat quotes. */
export interface ChatQuote {
  documentId: string
  /** The Document's title when the quote was taken, or null for an untitled one. */
  documentTitle: string | null
  quotedText: string
  lineFrom: number
  lineTo: number
}

/** A quote held by a chat, with a key that changes on every Quote in chat. */
export interface HeldChatQuote extends ChatQuote {
  key: number
}

/** "Line 3" or "Lines 3–5". */
export function quoteRangeLabel(
  quote: Pick<ChatQuote, "lineFrom" | "lineTo">
): string {
  return quote.lineFrom === quote.lineTo
    ? `Line ${quote.lineFrom}`
    : `Lines ${quote.lineFrom}–${quote.lineTo}`
}

type Listener = () => void

class ChatQuoteStore {
  private quotes = new Map<string, HeldChatQuote>()
  private listeners = new Map<string, Set<Listener>>()
  private foreground: string[] = []
  private waiting: ChatQuote | null = null
  private nextKey = 1

  /**
   * Quote a passage into the foreground chat. Returns the chat it landed in, or
   * null when no chat is on screen (the quote then waits for the next one).
   */
  reply(quote: ChatQuote): string | null {
    const chatId = this.foreground[this.foreground.length - 1]
    if (!chatId) {
      this.waiting = quote
      return null
    }
    this.waiting = null
    this.set(chatId, quote)
    return chatId
  }

  /**
   * Quote a passage into one chat, whether or not it is on screen: the chat
   * that made the Document (#1314). Clears any quote waiting for the
   * foreground, which this one replaces.
   */
  quoteInto(chatId: string, quote: ChatQuote): void {
    this.waiting = null
    this.set(chatId, quote)
  }

  /**
   * A chat on screen registers as the foreground. Returns an unregister to
   * call when it leaves the screen or unmounts. A quote waiting for a chat
   * lands in this one.
   */
  claimForeground(chatId: string): () => void {
    this.foreground = [...this.foreground.filter((id) => id !== chatId), chatId]
    if (this.waiting) {
      const quote = this.waiting
      this.waiting = null
      this.set(chatId, quote)
    }
    return () => {
      this.foreground = this.foreground.filter((id) => id !== chatId)
    }
  }

  /** The quote a chat holds, if any. */
  get(chatId: string): HeldChatQuote | undefined {
    return this.quotes.get(chatId)
  }

  /** Remove a chat's quote (its X). */
  remove(chatId: string): void {
    if (!this.quotes.delete(chatId)) return
    this.notify(chatId)
  }

  /** Take a chat's quote for the send it rides on, clearing it. */
  take(chatId: string): HeldChatQuote | undefined {
    const quote = this.quotes.get(chatId)
    if (quote) this.remove(chatId)
    return quote
  }

  /** Subscribe to one chat's quote. Returns an unsubscribe. */
  subscribe(chatId: string, listener: Listener): () => void {
    if (!this.listeners.has(chatId)) this.listeners.set(chatId, new Set())
    this.listeners.get(chatId)!.add(listener)
    return () => {
      const set = this.listeners.get(chatId)
      if (!set) return
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(chatId)
    }
  }

  private set(chatId: string, quote: ChatQuote) {
    this.quotes.set(chatId, { ...quote, key: this.nextKey++ })
    this.notify(chatId)
  }

  private notify(chatId: string) {
    this.listeners.get(chatId)?.forEach((l) => l())
  }
}

export const chatQuoteStore = new ChatQuoteStore()
