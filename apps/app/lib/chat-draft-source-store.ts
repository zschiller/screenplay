/**
 * Where a chat's draft came from (#1645): the Mockup whose page drafted a
 * message into the composer with `screenplay.draft(text)`.
 *
 * The canvas sets it as it prefills the composer; the composer shows it as a
 * From row at the top of the input box, and the chat's next send takes it, so
 * the message tells the agent which Mockup it was written on. Each chat holds
 * at most one: a draft from another Mockup replaces it. The row's X drops it
 * and keeps the text.
 */

/** The Mockup a draft was written on. */
export interface DraftSource {
  mockupId: string
  /** The Mockup's title when the draft arrived; empty for an untitled one. */
  title: string
}

type Listener = () => void

class ChatDraftSourceStore {
  private sources = new Map<string, DraftSource>()
  private listeners = new Map<string, Set<Listener>>()

  /** Mark a chat's draft as written on a Mockup. */
  set(chatId: string, source: DraftSource): void {
    this.sources.set(chatId, source)
    this.notify(chatId)
  }

  /** The source a chat's draft has, if any. */
  get(chatId: string): DraftSource | undefined {
    return this.sources.get(chatId)
  }

  /** Forget a chat's source (the row's X). */
  remove(chatId: string): void {
    if (!this.sources.delete(chatId)) return
    this.notify(chatId)
  }

  /** Take a chat's source for the send it rides on, clearing it. */
  take(chatId: string): DraftSource | undefined {
    const source = this.sources.get(chatId)
    if (source) this.remove(chatId)
    return source
  }

  /** Subscribe to one chat's source. Returns an unsubscribe. */
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

  private notify(chatId: string) {
    this.listeners.get(chatId)?.forEach((l) => l())
  }
}

export const chatDraftSourceStore = new ChatDraftSourceStore()
