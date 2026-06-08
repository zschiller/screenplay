import type { AgentMessage } from "@/lib/agent/types"
import {
  blockText,
  isUpdate,
  planFromPermissionRequest,
  type RequestPermissionRequest,
  type SessionUpdate,
} from "@/lib/agent/acp/schema"
import { applyToolCallUpdate } from "@/lib/agent/acp/record"
import { withBasePath } from "@/lib/base-path"

export type ChatState = {
  messages: AgentMessage[]
  isStreaming: boolean
  isLoadingHistory: boolean
  error: string | null
}

export interface SendMessageOptions {
  roomId: string
  chatId: string
  /** Sandbox-backed chat target. */
  sandboxName?: string
  branch?: string
  /** Document-layer chat target — mutually exclusive with sandboxName. */
  markdownLayerId?: string
  message: string
  isFirstChat?: boolean
  autoNamedBranch?: boolean
  planMode?: boolean
  model?: string
  onBranchRename?: (branch: string) => void
  onChatRename?: (label: string) => void
}

/**
 * A non-ACP control signal that rides its own broadcast envelope (ADR 0006).
 * ACP has no slot for these — auto-naming renames, the human plan resolution,
 * and turn errors — so they stay screenplay-shaped on a dedicated channel,
 * structurally distinct from the ACP `session/update` and permission-request
 * envelopes (the way the permission request is already kept apart).
 */
export type ChatControlEvent =
  | { kind: "branch_rename"; branch: string }
  | { kind: "chat_rename"; label: string }
  // The human resolved a plan gate — flip the matching plan card. The
  // continuation (and any reject feedback) rides its own `user` turn, so the
  // card carries only the resolved status.
  | { kind: "plan_resolved"; planId: string; approved: boolean }
  // A turn failure. ACP expresses errors out of band of the update stream, so
  // this is not a `session/update`; it surfaces the error in chat.
  | { kind: "error"; message: string }

/**
 * Envelope broadcast via the room Y.Doc to all clients. `id` is generated at
 * the broadcast boundary (`broadcastChatEventViaDoc`) and lets clients dedup
 * the same event when multiple subscribers feed it into the same store.
 */
export type ChatBroadcastEvent =
  // ACP-shaped update broadcast by the server (ADR 0006). The browser renders
  // the server's broadcast; it never opens an ACP connection of its own. Carries
  // the streamed `session/update`s — `agent_message_chunk`/`agent_thought_chunk`
  // deltas, the `tool_call` lifecycle, and the synchronous `user_message_chunk`
  // echo that transitions the client into streaming.
  | {
      type: "chat-acp-update"
      chatId: string
      id: string
      update: SessionUpdate
    }
  // ACP permission request broadcast by the server — screenplay's plan-mode
  // approval gate (ADR 0006). ACP's permission round-trip is a JSON-RPC request,
  // not a `session/update`, so it rides its own envelope and renders a plan card.
  | {
      type: "chat-acp-permission"
      chatId: string
      id: string
      request: RequestPermissionRequest
    }
  // Non-ACP control signals (renames, plan resolution, error) on their own
  // dedicated envelope.
  | {
      type: "chat-control"
      chatId: string
      id: string
      control: ChatControlEvent
    }
  | { type: "chat-stream-start"; chatId: string; id: string }
  | { type: "chat-stream-end"; chatId: string; id: string }

const DEFAULT_STATE: ChatState = {
  messages: [],
  isStreaming: false,
  isLoadingHistory: false,
  error: null,
}

async function fetchHistory(chatId: string): Promise<AgentMessage[]> {
  const res = await fetch(
    withBasePath(`/api/agent/history?chatId=${encodeURIComponent(chatId)}`)
  )
  if (!res.ok) return []
  return res.json()
}

/**
 * Merge a freshly-fetched server `history` with `live` messages already in
 * local state, when the live channel mutated state during the fetch.
 *
 * `useChatStreamEvents` only replays events from an in-progress stream
 * (completed streams are skipped), so when `live` is non-empty, `live[0]`
 * (the first user message) marks the start of the current turn. We anchor
 * on that user message to find where the current turn begins inside
 * `history`, then take history's past turns and live's tail (the in-flight
 * current turn) — preserving past turns that only history knows about while
 * keeping the live state for the in-flight turn intact.
 */
function mergeHistoryWithLive(
  history: AgentMessage[],
  live: AgentMessage[]
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

  /**
   * Set of broadcast-event ids already applied per chat. Both
   * `components/canvas/canvas.tsx` and `components/play/player-chat-host.tsx`
   * call `useChatStreamEvents` and route every event through this store, so
   * we'd otherwise apply each event twice (and `tool_use`/`tool_result` have
   * no per-event dedup of their own). React Strict Mode's double-invoked
   * effects produce the same hazard. Trim entries on cleanup.
   */
  private appliedEventIds = new Map<string, Set<string>>()

  /**
   * Per-chat accumulator for the ACP text path (ADR 0006). ACP
   * `agent_message_chunk`s carry *deltas*, so we accumulate them here and keep
   * the trailing assistant message in sync. `active` tells us whether the
   * trailing assistant message belongs to the current agent text block
   * (replace it) or a fresh block is starting (append). Reset on each
   * chat-stream-start and broken by any interleaving event.
   */
  private acpAgentText = new Map<string, { text: string; active: boolean }>()

  /**
   * Per-chat accumulator for ACP `agent_thought_chunk` reasoning deltas
   * (ADR 0006), mirroring {@link acpAgentText}. Kept separate so reasoning
   * accumulates into its own trailing `reasoning` message, distinct from the
   * assistant body. Reset on each chat-stream-start/end and broken by any
   * interleaving event.
   */
  private acpThoughtText = new Map<string, { text: string; active: boolean }>()

  /** Per-chat callbacks for branch_rename / chat_rename broadcast events. */
  private callbacks = new Map<
    string,
    {
      onBranchRename?: (branch: string) => void
      onChatRename?: (label: string) => void
    }
  >()

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

  loadHistory(chatId: string) {
    if (this.historyLoaded.has(chatId)) return
    this.historyLoaded.add(chatId)

    // Snapshot the mutation epoch so we can detect if optimistic adds or live
    // broadcast events touched messages while we were fetching. If they did,
    // the server snapshot is potentially stale relative to live state and we
    // merge instead of overwriting, so the user's just-sent message or
    // in-flight assistant tokens aren't clobbered.
    const epochAtStart = this.messagesEpoch.get(chatId) ?? 0

    this.update(chatId, { isLoadingHistory: true })
    fetchHistory(chatId)
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
        // Release the once-per-chat lock on failure so the next mount (or an
        // explicit retry) can try again, rather than leaving the chat
        // permanently stuck with empty history and no spinner.
        this.historyLoaded.delete(chatId)
        this.update(chatId, { isLoadingHistory: false })
      })
  }

  // --- Callbacks ---

  setCallbacks(
    chatId: string,
    cbs: {
      onBranchRename?: (branch: string) => void
      onChatRename?: (label: string) => void
    }
  ) {
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

    this.callbacks.set(chatId, {
      onBranchRename: opts.onBranchRename,
      onChatRename: opts.onChatRename,
    })

    try {
      const res = await fetch(withBasePath("/api/agent/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: opts.roomId,
          chatId: opts.chatId,
          sandboxName: opts.sandboxName,
          branch: opts.branch,
          markdownLayerId: opts.markdownLayerId,
          message: opts.message,
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
              "This chat's session has ended and can't be resumed. Please start a new chat to continue."
            )
          }
        }
        const errorText = await res.text()
        throw new Error(errorText || `HTTP ${res.status}`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const current = this.getOrCreate(chatId)
      this.update(chatId, {
        error: msg,
        messages: [...current.messages, { role: "error", content: msg }],
      })
    }
  }

  // --- External streaming state control (for hydration from storage) ---

  setStreaming(chatId: string, isStreaming: boolean) {
    this.update(chatId, { isStreaming })
  }

  // --- Stop a running stream ---

  async stopMessage(roomId: string, chatId: string) {
    // We used to flip `isStreaming` to false synchronously here, but that
    // raced with chunks the model had already buffered before the abort
    // propagated — the UI would show "stopped" while messages kept growing.
    // /api/agent/stop broadcasts `chat-stream-end` immediately on its end,
    // and the engine's onChunk now drops post-abort chunks, so the spinner
    // clears as soon as the broadcast lands (typically tens of ms).
    try {
      const res = await fetch(withBasePath("/api/agent/stop"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, chatId }),
      })
      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(errorText || `HTTP ${res.status}`)
      }
    } catch (e) {
      // Network failure means the server's broadcast may never land — fall
      // back to clearing local streaming state so the user isn't stuck.
      const msg = e instanceof Error ? e.message : String(e)
      this.update(chatId, { error: msg, isStreaming: false })
    }
  }

  // --- Handle broadcast events from Liveblocks (server or other clients) ---

  handleBroadcastEvent(event: ChatBroadcastEvent) {
    const chatId = event.chatId

    if (event.id) {
      let applied = this.appliedEventIds.get(chatId)
      if (!applied) {
        applied = new Set<string>()
        this.appliedEventIds.set(chatId, applied)
      }
      if (applied.has(event.id)) return
      applied.add(event.id)
    }

    switch (event.type) {
      case "chat-stream-start":
        // Reset the text-block accumulators so the next delta starts a fresh
        // assistant message rather than replacing the last one from a
        // previous turn.
        this.acpAgentText.delete(chatId)
        this.acpThoughtText.delete(chatId)
        this.update(chatId, { isStreaming: true })
        break

      case "chat-stream-end": {
        // Only mark unread on the streaming→not-streaming transition so
        // duplicate end signals don't re-stick the badge after `markRead`
        // already cleared it.
        const wasStreaming = this.getOrCreate(chatId).isStreaming
        if (wasStreaming) this.unreadChats.add(chatId)
        this.acpAgentText.delete(chatId)
        this.acpThoughtText.delete(chatId)
        this.update(chatId, { isStreaming: false })
        break
      }

      case "chat-acp-update":
        this.applyAcpUpdate(chatId, event.update)
        break

      case "chat-acp-permission":
        this.applyAcpPermission(chatId, event.request)
        break

      case "chat-control":
        this.applyControl(chatId, event.control)
        break
    }
  }

  /**
   * Apply a non-ACP control signal (ADR 0006): an auto-naming rename (delegated
   * to the registered callback), a plan resolution (flip the matching plan
   * card), or a turn error (surface it in chat). These have no ACP slot, so they
   * ride their own envelope rather than a `session/update`.
   */
  private applyControl(chatId: string, control: ChatControlEvent) {
    const cbs = this.callbacks.get(chatId)
    switch (control.kind) {
      case "branch_rename":
        cbs?.onBranchRename?.(control.branch)
        break
      case "chat_rename":
        cbs?.onChatRename?.(control.label)
        break
      case "plan_resolved": {
        const prev = this.getOrCreate(chatId).messages
        this.update(chatId, {
          messages: prev.map((m) =>
            m.role === "plan" && m.planId === control.planId
              ? {
                  ...m,
                  status: control.approved
                    ? ("approved" as const)
                    : ("rejected" as const),
                }
              : m
          ),
        })
        break
      }
      case "error":
        this.update(chatId, {
          error: control.message,
          messages: [
            ...this.getOrCreate(chatId).messages,
            { role: "error" as const, content: control.message },
          ],
        })
        break
    }
  }

  /**
   * Render an ACP permission request as a pending plan card (ADR 0006) — the
   * ACP-shaped equivalent of the legacy `plan_submitted` event. The plan text
   * and its tool-call id ride the request's `toolCall`; the human approves or
   * rejects through the same `/api/agent/plan` lifecycle.
   */
  private applyAcpPermission(
    chatId: string,
    request: RequestPermissionRequest
  ) {
    const { toolCallId, plan } = planFromPermissionRequest(request)
    // A permission request closes any in-flight agent text block.
    this.acpAgentText.delete(chatId)
    const prev = this.getOrCreate(chatId).messages
    this.update(chatId, {
      messages: [
        ...prev,
        {
          role: "plan" as const,
          content: plan,
          status: "pending" as const,
          planId: toolCallId,
        },
      ],
    })
  }

  /**
   * Apply a single ACP `session/update` broadcast to local state (ADR 0006).
   * `agent_message_chunk` deltas accumulate into the trailing assistant message
   * (the ACP-shaped equivalent of the legacy cumulative `text` event), and
   * `agent_thought_chunk` deltas accumulate into a trailing `reasoning` message
   * so the agent's streamed thinking renders apart from its reply.
   * `tool_call` / `tool_call_update` drive a tool call through its status
   * lifecycle in place, keyed by id. Other `sessionUpdate` kinds are no-ops here
   * until later slices render them.
   */
  private applyAcpUpdate(chatId: string, update: SessionUpdate) {
    if (isUpdate(update, "user_message_chunk")) {
      this.appendUserEcho(chatId, blockText(update.content))
      return
    }
    if (isUpdate(update, "agent_message_chunk")) {
      this.appendAcpDelta(
        chatId,
        "assistant",
        this.acpAgentText,
        this.acpThoughtText,
        blockText(update.content)
      )
      return
    }
    if (isUpdate(update, "agent_thought_chunk")) {
      this.appendAcpDelta(
        chatId,
        "reasoning",
        this.acpThoughtText,
        this.acpAgentText,
        blockText(update.content)
      )
      return
    }
    if (isUpdate(update, "tool_call") || isUpdate(update, "tool_call_update")) {
      this.applyAcpToolCall(chatId, update)
      return
    }
  }

  /**
   * Append the synchronous user-message echo (ADR 0006) — the ACP
   * `user_message_chunk` the route broadcasts so the client transitions into
   * streaming. Dedups against the optimistic add the sending client already
   * made (its trailing message is the identical user turn); other browsers and
   * late joiners append it fresh. The echo closes any in-flight agent/thought
   * block so the next agent delta starts a new message.
   */
  private appendUserEcho(chatId: string, text: string) {
    this.acpAgentText.delete(chatId)
    this.acpThoughtText.delete(chatId)
    const prev = this.getOrCreate(chatId).messages
    const last = prev[prev.length - 1]
    if (last?.role === "user" && last.content === text) return
    this.update(chatId, {
      messages: [...prev, { role: "user" as const, content: text }],
    })
  }

  /**
   * Accumulate one ACP text `delta` into the trailing message of the given
   * `role`, continuing that block while it's still active and ours, or starting
   * a fresh message otherwise. The two ACP text streams (assistant reply,
   * reasoning) each own an accumulator; emitting one breaks the other (`other`)
   * so switching streams always starts a fresh block.
   */
  private appendAcpDelta(
    chatId: string,
    role: "assistant" | "reasoning",
    own: Map<string, { text: string; active: boolean }>,
    other: Map<string, { text: string; active: boolean }>,
    delta: string
  ) {
    const otherBuf = other.get(chatId)
    if (otherBuf) other.set(chatId, { ...otherBuf, active: false })

    const prev = this.getOrCreate(chatId).messages
    const buf = own.get(chatId)
    const last = prev[prev.length - 1]
    const sameBlock = buf?.active === true && last?.role === role
    const text = (sameBlock ? buf!.text : "") + delta
    own.set(chatId, { text, active: true })

    const message = { role, content: text }
    this.update(chatId, {
      messages: sameBlock
        ? [...prev.slice(0, -1), message]
        : [...prev, message],
    })
  }

  /**
   * Apply a `tool_call` / `tool_call_update` to local state in place, keyed by
   * `toolCallId`: the first `tool_call` appends a row; each later update merges
   * onto that same row (status, structured content) so the call advances
   * `pending` → `in_progress` → `completed`/`failed` without spawning new rows.
   * An update for an id we haven't seen seeds a fresh row (lenient — a provider
   * may skip the initial `tool_call`).
   */
  private applyAcpToolCall(chatId: string, update: SessionUpdate) {
    if (
      !isUpdate(update, "tool_call") &&
      !isUpdate(update, "tool_call_update")
    ) {
      return
    }
    // A tool call breaks both ACP text streams — the next agent or thought
    // delta should start a fresh message rather than replacing this one.
    this.acpAgentText.delete(chatId)
    this.acpThoughtText.delete(chatId)

    const prev = this.getOrCreate(chatId).messages
    const idx = prev.findIndex(
      (m) => m.role === "tool_call" && m.toolCallId === update.toolCallId
    )
    const existing =
      idx >= 0
        ? (prev[idx] as Extract<AgentMessage, { role: "tool_call" }>)
        : undefined
    const merged = applyToolCallUpdate(existing, update)
    const message: AgentMessage = {
      role: "tool_call",
      toolCallId: merged.toolCallId,
      title: merged.title,
      kind: merged.kind,
      status: merged.status,
      content: merged.content,
      rawInput: merged.rawInput,
    }

    if (idx >= 0) {
      const next = prev.slice()
      next[idx] = message
      this.update(chatId, { messages: next })
    } else {
      this.update(chatId, { messages: [...prev, message] })
    }
  }

  // --- Plan approval ---

  async approvePlan(roomId: string, chatId: string, planId: string) {
    try {
      const res = await fetch(withBasePath("/api/agent/plan"), {
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

  async rejectPlan(
    roomId: string,
    chatId: string,
    planId: string,
    feedback: string
  ) {
    try {
      const res = await fetch(withBasePath("/api/agent/plan"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          chatId,
          planId,
          approved: false,
          feedback,
        }),
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
    this.historyLoaded.delete(chatId)
    this.unreadChats.delete(chatId)
    this.callbacks.delete(chatId)
    this.messagesEpoch.delete(chatId)
    this.appliedEventIds.delete(chatId)
    this.acpAgentText.delete(chatId)
    this.acpThoughtText.delete(chatId)
    this.notify(chatId)
    this.listeners.delete(chatId)
  }
}

export const chatStore = new ChatStore()
