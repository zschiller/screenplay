type Listener = (text: string) => void

class InputStore {
  private listeners = new Map<string, Set<Listener>>()

  append(chatId: string, text: string) {
    this.listeners.get(chatId)?.forEach((l) => l(text))
  }

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
}

export const inputStore = new InputStore()
