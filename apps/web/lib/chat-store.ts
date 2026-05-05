import type { AgentMessage, AgentStreamEvent, CustomToolName } from "@/lib/agent/types"

export type ChatState = {
  messages: AgentMessage[]
  isStreaming: boolean
  isLoadingHistory: boolean
  error: string | null
}

export interface SendMessageOptions {
  roomId: string
  chatId: string
  sandboxName: string
  branch: string
  message: string
  isFirstChat?: boolean
  autoNamedBranch?: boolean
  sessionId?: string
  planMode?: boolean
  model?: string
  onSessionId?: (sessionId: string) => void
  onBranchRename?: (branch: string) => void
  onChatRename?: (label: string) => void
}

/** Envelope broadcast via Liveblocks to all clients in the room. */
export type ChatBroadcastEvent =
  | { type: "chat-stream"; chatId: string; event: AgentStreamEvent }
  | { type: "chat-stream-start"; chatId: string }
  | { type: "chat-stream-end"; chatId: string }

const DEFAULT_STATE: ChatState = {
  messages: [],
  isStreaming: false,
  isLoadingHistory: false,
  error: null,
}

async function fetchHistory(sessionId: string): Promise<AgentMessage[]> {
  const res = await fetch(
    `/api/agent/history?sessionId=${encodeURIComponent(sessionId)}`,
  )
  if (!res.ok) return []
  return res.json()
}

/**
 * Merge a freshly-fetched server `history` with `live` messages already in
 * local state, when the live channel mutated state during the fetch.
 *
 * The Yjs replay in `useChatStreamEvents` always starts at the most recent
 * `chat-stream-start`, so when `live` is non-empty, `live[0]` (the first user
 * message) marks the start of the current turn. We anchor on that user message
 * to find where the current turn begins inside `history`, then take history's
 * past turns and live's tail (the in-flight current turn) — preserving past
 * turns that only history knows about while keeping the live state for the
 * in-flight turn intact.
 */
function mergeHistoryWithLive(
  history: AgentMessage[],
  live: AgentMessage[],
): AgentMessage[] {
  if (live.length === 0) return history
  const anchorIdx = live.findIndex((m) => m.role === "user")
  if (anchorIdx === -1) return history
  const anchor = live[anchorIdx]
  if (anchor.role !== "user") return history
  // Walk history backwards to find the same user message — last occurrence
  // wins so a repeated prompt aligns to the most recent turn.
  let historyAnchorIdx = -1
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]
    if (h.role === "user" && h.content === anchor.content) {
      historyAnchorIdx = i
      break
    }
  }
  if (historyAnchorIdx === -1) {
    // Anchor not found — likely the live message hasn't been persisted yet.
    // Append the entire live tail after history rather than dropping either
    // side; the live channel will reconcile if anything overlaps.
    return [...history, ...live.slice(anchorIdx)]
  }
  return [...history.slice(0, historyAnchorIdx), ...live.slice(anchorIdx)]
}

class ChatStore {
  private states = new Map<string, ChatState>()
  private sessionIds = new Map<string, string>()
  private historyLoaded = new Set<string>()
  private listeners = new Map<string, Set<() => void>>()
  private unreadChats = new Set<string>()
  /**
   * Per-chat mutation counter, bumped whenever local `messages` changes
   * (optimistic add, live broadcast event, etc.). Used by `loadHistory` to
   * detect that local state moved while its fetch was in flight, so the
   * (now-stale) server snapshot doesn't clobber live state.
   */
  private messagesEpoch = new Map<string, number>()

  /** Registered per-chat callbacks for session_id and branch_rename events. */
  private callbacks = new Map<string, { onSessionId?: (sid: string) => void; onBranchRename?: (branch: string) => void; onChatRename?: (label: string) => void }>()

  private getOrCreate(chatId: string): ChatState {
    let state = this.states.get(chatId)
    if (!state) {
      state = { ...DEFAULT_STATE }
      this.states.set(chatId, state)
    }
    return state
  }

  private update(chatId: string, partial: Partial<ChatState>) {
    const current = this.getOrCreate(chatId)
    if (partial.messages !== undefined) {
      this.messagesEpoch.set(chatId, (this.messagesEpoch.get(chatId) ?? 0) + 1)
    }
    this.states.set(chatId, { ...current, ...partial })
    this.notify(chatId)
  }

  private notify(chatId: string) {
    this.listeners.get(chatId)?.forEach((l) => l())
  }

  // --- Subscriptions (for useSyncExternalStore) ---

  subscribe(chatId: string, listener: () => void): () => void {
    if (!this.listeners.has(chatId)) this.listeners.set(chatId, new Set())
    this.listeners.get(chatId)!.add(listener)
    return () => {
      this.listeners.get(chatId)?.delete(listener)
      if (this.listeners.get(chatId)?.size === 0) {
        this.listeners.delete(chatId)
      }
    }
  }

  getSnapshot(chatId: string): ChatState {
    return this.getOrCreate(chatId)
  }

  // --- History loading (initial load only) ---

  loadHistory(chatId: string, sessionId: string) {
    if (this.historyLoaded.has(chatId)) return
    this.historyLoaded.add(chatId)
    this.sessionIds.set(chatId, sessionId)

    // Snapshot the mutation epoch so we can detect if optimistic adds or live
    // broadcast events touched messages while we were fetching. If they did,
    // the server snapshot is potentially stale relative to live state and we
    // merge instead of overwriting, so the user's just-sent message or
    // in-flight assistant tokens aren't clobbered.
    const epochAtStart = this.messagesEpoch.get(chatId) ?? 0

    this.update(chatId, { isLoadingHistory: true })
    fetchHistory(sessionId)
      .then((history) => {
        if (history.length === 0) {
          this.update(chatId, { isLoadingHistory: false })
          return
        }
        const current = this.getOrCreate(chatId)
        const currentEpoch = this.messagesEpoch.get(chatId) ?? 0
        const stale = currentEpoch !== epochAtStart
        const messages = stale
          ? mergeHistoryWithLive(history, current.messages)
          : history
        this.update(chatId, { messages, isLoadingHistory: false })
      })
      .catch(() => {
        this.update(chatId, { isLoadingHistory: false })
      })
  }

  // --- Callbacks ---

  setCallbacks(chatId: string, cbs: { onSessionId?: (sid: string) => void; onBranchRename?: (branch: string) => void; onChatRename?: (label: string) => void }) {
    this.callbacks.set(chatId, cbs)
  }

  clearCallbacks(chatId: string) {
    this.callbacks.delete(chatId)
  }

  // --- Send message (fire-and-forget POST, server broadcasts via Liveblocks) ---

  async sendMessage(opts: SendMessageOptions) {
    const { chatId } = opts
    const state = this.getOrCreate(chatId)
    if (!opts.message.trim() || state.isStreaming) return

    // Optimistically add the user message
    this.update(chatId, {
      error: null,
      messages: [...state.messages, { role: "user", content: opts.message }],
    })

    // Register callbacks for this chat so broadcast events can invoke them
    this.callbacks.set(chatId, { onSessionId: opts.onSessionId, onBranchRename: opts.onBranchRename, onChatRename: opts.onChatRename })

    try {
      const res = await fetch("/api/agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: opts.roomId,
          chatId: opts.chatId,
          sandboxName: opts.sandboxName,
          branch: opts.branch,
          message: opts.message,
          sessionId: this.sessionIds.get(chatId) ?? opts.sessionId,
          isFirstChat: opts.isFirstChat,
          autoNamedBranch: opts.autoNamedBranch,
          planMode: opts.planMode,
          model: opts.model,
        }),
      })

      if (!res.ok) {
        if (res.status === 409) {
          const body = await res.json().catch(() => null)
          if (body?.error === "session_terminated") {
            throw new Error(
              "This chat's session has ended and can't be resumed. Please start a new chat to continue.",
            )
          }
        }
        const errorText = await res.text()
        throw new Error(errorText || `HTTP ${res.status}`)
      }

      // The server returns the sessionId — store it locally
      const data = await res.json()
      if (data.sessionId) {
        this.sessionIds.set(chatId, data.sessionId)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const current = this.getOrCreate(chatId)
      this.update(chatId, {
        error: msg,
        messages: [
          ...current.messages,
          { role: "error", content: msg },
        ],
      })
    }
  }

  // --- External streaming state control (for hydration from storage) ---

  setStreaming(chatId: string, isStreaming: boolean) {
    this.update(chatId, { isStreaming })
  }

  // --- Stop a running stream by interrupting the underlying session ---

  async stopMessage(roomId: string, chatId: string) {
    const sessionId = this.sessionIds.get(chatId)
    if (!sessionId) return
    // Flip the UI to non-streaming immediately. The server still broadcasts
    // chat-stream-end after the upstream interrupt resolves, but the user's
    // intent to stop shouldn't depend on that round-trip succeeding.
    this.update(chatId, { isStreaming: false })
    try {
      const res = await fetch("/api/agent/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, chatId, sessionId }),
      })
      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(errorText || `HTTP ${res.status}`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.update(chatId, { error: msg })
    }
  }

  // --- Handle broadcast events from Liveblocks (server or other clients) ---

  handleBroadcastEvent(event: ChatBroadcastEvent) {
    const chatId = event.chatId

    switch (event.type) {
      case "chat-stream-start":
        this.update(chatId, { isStreaming: true })
        break

      case "chat-stream-end": {
        // Only mark unread on the streaming→not-streaming transition so
        // duplicate end signals (e.g. stop endpoint + background stream)
        // don't re-stick the badge after `markRead` already cleared it.
        const wasStreaming = this.getOrCreate(chatId).isStreaming
        if (wasStreaming) this.unreadChats.add(chatId)
        this.update(chatId, { isStreaming: false })
        break
      }

      case "chat-stream":
        this.applyEvent(chatId, event.event)
        break
    }
  }

  /** Apply a single agent stream event to local state. */
  private applyEvent(chatId: string, event: AgentStreamEvent) {
    const cbs = this.callbacks.get(chatId)

    switch (event.type) {
      case "session_id":
        this.sessionIds.set(chatId, event.sessionId)
        cbs?.onSessionId?.(event.sessionId)
        break

      case "user_message": {
        const prev = this.getOrCreate(chatId).messages
        // Avoid duplicating if the sending client already added it optimistically
        const last = prev[prev.length - 1]
        if (last?.role === "user" && last.content === event.text) break
        this.update(chatId, {
          messages: [...prev, { role: "user" as const, content: event.text }],
        })
        break
      }

      case "text": {
        const prev = this.getOrCreate(chatId).messages
        const last = prev[prev.length - 1]
        if (last?.role === "assistant") {
          this.update(chatId, {
            messages: [
              ...prev.slice(0, -1),
              { role: "assistant" as const, content: event.text },
            ],
          })
        } else {
          this.update(chatId, {
            messages: [
              ...prev,
              { role: "assistant" as const, content: event.text },
            ],
          })
        }
        break
      }

      case "tool_use":
        this.update(chatId, {
          messages: [
            ...this.getOrCreate(chatId).messages,
            {
              role: "tool_use" as const,
              name: event.name as CustomToolName,
              input: event.input,
            },
          ],
        })
        break

      case "tool_result":
        this.update(chatId, {
          messages: [
            ...this.getOrCreate(chatId).messages,
            {
              role: "tool_result" as const,
              name: event.name as CustomToolName,
              output: event.output,
            },
          ],
        })
        break

      case "branch_rename":
        cbs?.onBranchRename?.(event.branch)
        break

      case "chat_rename":
        cbs?.onChatRename?.(event.label)
        break

      case "plan_submitted": {
        const prev = this.getOrCreate(chatId).messages
        this.update(chatId, {
          messages: [
            ...prev,
            {
              role: "plan" as const,
              content: event.plan,
              status: "pending" as const,
              planId: event.planId,
            },
          ],
        })
        break
      }

      case "plan_approved": {
        const prev = this.getOrCreate(chatId).messages
        this.update(chatId, {
          messages: prev.map((m) =>
            m.role === "plan" && m.planId === event.planId
              ? { ...m, status: "approved" as const }
              : m
          ),
        })
        break
      }

      case "plan_rejected": {
        const prev = this.getOrCreate(chatId).messages
        this.update(chatId, {
          messages: prev.map((m) =>
            m.role === "plan" && m.planId === event.planId
              ? { ...m, status: "rejected" as const }
              : m
          ),
        })
        break
      }

      case "error":
        this.update(chatId, {
          error: event.message,
          messages: [
            ...this.getOrCreate(chatId).messages,
            { role: "error" as const, content: event.message },
          ],
        })
        break

      case "done":
        break
    }
  }

  // --- Plan approval ---

  async approvePlan(roomId: string, chatId: string, planId: string) {
    try {
      const res = await fetch("/api/agent/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, chatId, planId, approved: true }),
      })
      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(errorText || `HTTP ${res.status}`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.update(chatId, {
        error: msg,
        messages: [
          ...this.getOrCreate(chatId).messages,
          { role: "error" as const, content: `Failed to approve plan: ${msg}` },
        ],
      })
    }
  }

  async rejectPlan(roomId: string, chatId: string, planId: string, feedback: string) {
    try {
      const res = await fetch("/api/agent/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, chatId, planId, approved: false, feedback }),
      })
      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(errorText || `HTTP ${res.status}`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.update(chatId, {
        error: msg,
        messages: [
          ...this.getOrCreate(chatId).messages,
          { role: "error" as const, content: `Failed to reject plan: ${msg}` },
        ],
      })
    }
  }

  // --- Unread tracking ---

  markRead(chatId: string) {
    if (this.unreadChats.delete(chatId)) {
      this.notify(chatId)
    }
  }

  hasUnread(chatId: string): boolean {
    return this.unreadChats.has(chatId)
  }

  // --- Cleanup ---

  cleanup(chatId: string) {
    this.states.delete(chatId)
    this.sessionIds.delete(chatId)
    this.historyLoaded.delete(chatId)
    this.unreadChats.delete(chatId)
    this.callbacks.delete(chatId)
    this.messagesEpoch.delete(chatId)
    this.notify(chatId)
    this.listeners.delete(chatId)
  }
}

export const chatStore = new ChatStore()
