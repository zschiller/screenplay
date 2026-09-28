type Listener = (text: string) => void

class InputStore {
  private listeners = new Map<string, Set<Listener>>()
  private sendListeners = new Map<string, Set<Listener>>()
  private pending = new Map<string, string[]>()

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

  send(chatId: string, text: string) {
    this.sendListeners.get(chatId)?.forEach((l) => l(text))
  }

  subscribeSend(chatId: string, listener: Listener): () => void {
    if (!this.sendListeners.has(chatId))
      this.sendListeners.set(chatId, new Set())
    this.sendListeners.get(chatId)!.add(listener)
    return () => {
      const set = this.sendListeners.get(chatId)
      if (!set) return
      set.delete(listener)
      if (set.size === 0) this.sendListeners.delete(chatId)
    }
  }
}

export const inputStore = new InputStore()
