type Listener = (text: string) => void
/** A chat taking a sent message; resolves `false` when the send is refused. */
type SendListener = (text: string) => unknown

class InputStore {
  private listeners = new Map<string, Set<Listener>>()
  private sendListeners = new Map<string, Set<SendListener>>()
  private pending = new Map<string, string[]>()
  private pendingSends = new Map<string, string[]>()

  append(chatId: string, text: string) {
    this.listeners.get(chatId)?.forEach((l) => l(text))
  }

  /**
   * Like {@link append}, but for a chat that may not be mounted yet (it was
   * just selected, so its composer subscribes on the next commit): the text is
   * held until a composer subscribes, instead of being dropped.
   */
  prefill(chatId: string, text: string) {
    if (this.listeners.get(chatId)?.size) {
      this.append(chatId, text)
      return
    }
    this.pending.set(chatId, [...(this.pending.get(chatId) ?? []), text])
  }

  subscribe(chatId: string, listener: Listener): () => void {
    if (!this.listeners.has(chatId)) this.listeners.set(chatId, new Set())
    this.listeners.get(chatId)!.add(listener)
    const held = this.pending.get(chatId)
    if (held) {
      this.pending.delete(chatId)
      held.forEach((text) => listener(text))
    }
    return () => {
      const set = this.listeners.get(chatId)
      if (!set) return
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(chatId)
    }
  }

  /**
   * Send a message from the chat's composer path. Resolves `false` when no
   * chat took it or the chat's send was refused (it then holds the text for
   * Retry), so a caller that closed on the send can open again.
   */
  async send(chatId: string, text: string): Promise<boolean> {
    const listeners = [...(this.sendListeners.get(chatId) ?? [])]
    if (!listeners.length) return false
    const results = await Promise.all(listeners.map((l) => l(text)))
    return results.every((r) => r !== false)
  }

  /**
   * Like {@link send}, for a chat that was just opened and whose chat may not
   * be mounted yet: the message is held until it subscribes, instead of being
   * dropped. A Mockup page's answer (#1644) opens its chat and sends this way.
   */
  sendWhenOpen(chatId: string, text: string) {
    if (this.sendListeners.get(chatId)?.size) {
      void this.send(chatId, text)
      return
    }
    this.pendingSends.set(chatId, [
      ...(this.pendingSends.get(chatId) ?? []),
      text,
    ])
  }

  subscribeSend(chatId: string, listener: SendListener): () => void {
    if (!this.sendListeners.has(chatId))
      this.sendListeners.set(chatId, new Set())
    this.sendListeners.get(chatId)!.add(listener)
    const held = this.pendingSends.get(chatId)
    if (held) {
      this.pendingSends.delete(chatId)
      held.forEach((text) => listener(text))
    }
    return () => {
      const set = this.sendListeners.get(chatId)
      if (!set) return
      set.delete(listener)
      if (set.size === 0) this.sendListeners.delete(chatId)
    }
  }
}

export const inputStore = new InputStore()
