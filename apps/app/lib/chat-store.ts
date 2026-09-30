import type { AgentMessage } from "@/lib/agent/types"
import {
  blockText,
  isUpdate,
  planFromPermissionRequest,
  type RequestPermissionRequest,
  type SessionUpdate,
} from "@/lib/agent/acp/schema"
import { applyToolCallUpdate } from "@/lib/agent/acp/record"
import { describeSendError, describeTurnError } from "@/lib/agent/chat-errors"
import { withBasePath } from "@/lib/base-path"
import { bareToolName } from "@/lib/agent/tool-name"
import { viewRequestIds, viewRequests } from "@/lib/canvas/view-requests"
import { isFixtureWorld } from "@/lib/fixture-world"
import { userTurnMessage } from "@/lib/agent/user-turn"
import type { ChatTarget } from "@/lib/chat/chat-target"

export type ChatState = {
  messages: AgentMessage[]
  isStreaming: boolean
  isLoadingHistory: boolean
  /** The history fetch failed, so an empty log isn't an empty chat. */
  historyFailed: boolean
  error: string | null
  /**
   * The last send the server refused, held so the user can Retry it or pull it
   * back into the composer to Edit. The optimistic user message is removed when
   * this is set, so the failed text lives here and nowhere else in the log.
   */
  failedSend: FailedSend | null
  /**
   * Messages sent while a run was going on an Engine that can't steer. The
   * head is sent when the run ends; each is cancellable until then.
   */
  queued: QueuedMessage[]
  /**
   * Messages sent while a run was going that joined it as Steers (#1190),
   * from anyone in the Room, oldest first. Each waits here until the agent
   * takes it, when it moves into `messages` where the agent took it.
   */
  pendingSteers: PendingSteer[]
  /**
   * Whether the running turn takes Steers, as the server said once its
   * Engine's session opened (#1250). Null until it says; a send then queues.
   */
  steerable: boolean | null
  /**
   * Steers this client sent that a stop handed back, waiting to go into the
   * composer (#1190).
   */
  returnedSteers: ReturnedSteer[]
  /**
   * Where the running turn began in `messages` (its `chat-stream-start`), so
   * the part of the run before a Steer the agent took still reads as live.
   * Null when no run is going.
   */
  runStart: number | null
}

/** A Steer the agent hasn't taken yet (#1190). */
export interface PendingSteer {
  /** Stable across the id arriving, for React keys and local lookups. */
  key: string
  /** The server's id, once known; a local send has none until it answers. */
  id?: string
  message: string
  /** Set on a Steer this client sent: the composer document, for a stop to restore. */
  local?: { draft?: unknown }
}

/** A stopped run's untaken Steer, back for the composer. */
export interface ReturnedSteer {
  message: string
  draft?: unknown
}

/** A send the server didn't accept (#802). */
export interface FailedSend {
  message: string
  error: string
  /** The composer's own document for the draft, to restore it on Edit. */
  draft?: unknown
  options: SendMessageOptions
}

/**
 * The `/api/agent/stream` body fields that name a Chat Target. The one place a
 * client {@link ChatTarget} becomes the wire shape.
 */
function wireTarget(target: ChatTarget): {
  sandboxName?: string
  markdownLayerId?: string
  target?: "room"
} {
  switch (target.kind) {
    case "agent":
      return { sandboxName: target.sandboxName }
    case "document":
      return { markdownLayerId: target.layerId }
    case "room":
      return { target: "room" }
  }
}

/** A message waiting for the current run to finish (#802). */
export interface QueuedMessage {
  id: string
  message: string
  draft?: unknown
  options: SendMessageOptions
}

export interface SendMessageOptions {
  roomId: string
  chatId: string
  /** What the chat talks to; mapped to the wire target by {@link wireTarget}. */
  target: ChatTarget
  message: string
  isFirstChat?: boolean
  planMode?: boolean
  model?: string
  /** Comment threads this message asks the agent to address (#788). */
  commentThreadIds?: string[]
  /**
   * The composer's document for this message. Opaque to the store: it rides
   * along so a failed or queued message can be put back in the composer intact
   * (mentions and element tokens included), not as flattened wire text.
   */
  draft?: unknown
}

/**
 * A non-ACP control signal that rides its own broadcast envelope (ADR 0006).
 * ACP has no slot for these — the human plan resolution and turn errors — so they stay screenplay-shaped on a dedicated channel,
 * structurally distinct from the ACP `session/update` and permission-request
 * envelopes (the way the permission request is already kept apart).
 */
export type ChatControlEvent =
  // The human resolved a plan gate — flip the matching plan card. The
  // continuation (and any reject feedback) rides its own `user` turn, so the
  // card carries only the resolved status.
  | { kind: "plan_resolved"; planId: string; approved: boolean }
  // A turn failure. ACP expresses errors out of band of the update stream, so
  // this is not a `session/update`; it surfaces the error in chat.
  | { kind: "error"; message: string }
  // The user stopped the run. Sent by /api/agent/stop just before
  // `chat-stream-end`, so every client drops the same "Stopped" marker into the
  // transcript that a reload rebuilds from the run's `aborted` status.
  | { kind: "stopped" }
  // Whether the running turn takes Steers (#1190), sent once its Engine's
  // session is open (#1250). After `chat-stream-start`, so a client joining
  // mid-run learns it on replay.
  | { kind: "steerable"; steerable: boolean }
  // A message sent mid-run joined the run as a pending Steer (#1190).
  | { kind: "steer_pending"; steer: { id: string; message: string } }
  // These Steers are no longer pending: the Engine took them (their echoes
  // follow) or they started the next turn (its echo follows).
  | { kind: "steers_taken"; ids: string[] }
  // A stopped run's Steers the Engine never took, handed back to the sender.
  | {
      kind: "steers_returned"
      steers: Array<{ id: string; message: string; userId: string | null }>
    }

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
  historyFailed: false,
  error: null,
  failedSend: null,
  queued: [],
  pendingSteers: [],
  steerable: null,
  returnedSteers: [],
  runStart: null,
}

async function fetchHistory(chatId: string): Promise<AgentMessage[]> {
  const res = await fetch(
    withBasePath(`/api/agent/history?chatId=${encodeURIComponent(chatId)}`)
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
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

let queueSeq = 0
let steerSeq = 0

class ChatStore {
  private states = new Map<string, ChatState>()
  private historyLoaded = new Set<string>()

  /**
   * What Retry on a transcript error does, by the error message it sits on.
   * Kept out of the message itself, which is plain data that also comes from
   * the server and from other clients.
   */
  private errorRetries = new WeakMap<AgentMessage, () => Promise<unknown>>()

  /**
   * The last message this client started a turn with, per chat, so Retry on
   * that turn's failure can send it again.
   */
  private lastTurn = new Map<string, SendMessageOptions>()
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
   * Chats whose running (or about to start) turn this client asked for: set
   * on each send or Steer, cleared when the run ends. Only the asker's view
   * follows the Coordinator's `show_on_canvas`.
   */
  private askedHere = new Set<string>()

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

  /**
   * Steer ids per chat that are no longer pending (taken, started a turn, or
   * returned), so a pending broadcast or a send's answer arriving after the
   * fact can't bring one back.
   */
  private settledSteers = new Map<string, Set<string>>()

  private steerSettled(chatId: string, id: string): boolean {
    return this.settledSteers.get(chatId)?.has(id) ?? false
  }

  /** Show a Steer as pending, or name the local one it answers. */
  private addPendingSteer(chatId: string, steer: PendingSteer) {
    if (!steer.id || this.steerSettled(chatId, steer.id)) return
    const { pendingSteers } = this.getOrCreate(chatId)
    if (pendingSteers.some((p) => p.id === steer.id)) return
    // This client's own send, whose answer hasn't come back yet.
    const mine = pendingSteers.find(
      (p) => p.local && !p.id && p.message === steer.message
    )
    this.update(chatId, {
      pendingSteers: mine
        ? pendingSteers.map((p) => (p === mine ? { ...p, id: steer.id } : p))
        : [...pendingSteers, steer],
    })
  }

  /**
   * Settle Steers that are no longer pending. Returned ones this client sent
   * go back to its composer; everywhere else they just disappear.
   */
  private settleSteers(chatId: string, ids: string[], returned: boolean) {
    let settled = this.settledSteers.get(chatId)
    if (!settled) {
      settled = new Set()
      this.settledSteers.set(chatId, settled)
    }
    for (const id of ids) settled.add(id)
    const { pendingSteers, returnedSteers } = this.getOrCreate(chatId)
    const gone = pendingSteers.filter((p) => p.id && ids.includes(p.id))
    if (gone.length === 0) return
    this.update(chatId, {
      pendingSteers: pendingSteers.filter((p) => !gone.includes(p)),
      returnedSteers: returned
        ? [
            ...returnedSteers,
            ...gone.flatMap((p) =>
              p.local ? [{ message: p.message, draft: p.local.draft }] : []
            ),
          ]
        : returnedSteers,
    })
  }

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

  loadHistory(chatId: string): Promise<void> {
    if (this.historyLoaded.has(chatId)) return Promise.resolve()
    this.historyLoaded.add(chatId)

    // Snapshot the mutation epoch so we can detect if optimistic adds or live
    // broadcast events touched messages while we were fetching. If they did,
    // the server snapshot is potentially stale relative to live state and we
    // merge instead of overwriting, so the user's just-sent message or
    // in-flight assistant tokens aren't clobbered.
    const epochAtStart = this.messagesEpoch.get(chatId) ?? 0

    this.update(chatId, { isLoadingHistory: true, historyFailed: false })
    return fetchHistory(chatId)
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
        // Keep the running turn's start on the same message after the merge.
        const runStart =
          current.runStart === null
            ? null
            : Math.max(
                0,
                messages.length - (current.messages.length - current.runStart)
              )
        this.update(chatId, { messages, isLoadingHistory: false, runStart })
      })
      .catch(() => {
        // Release the once-per-chat lock on failure so the next mount (or an
        // explicit retry) can try again, rather than leaving the chat
        // permanently stuck with empty history and no spinner.
        this.historyLoaded.delete(chatId)
        this.update(chatId, { isLoadingHistory: false, historyFailed: true })
      })
  }

  // --- Send message (fire-and-forget POST, server broadcasts via Liveblocks) ---

  /**
   * Send a turn. While a run is going, the message steers it (#1190): it shows
   * as a pending Steer at once, and the server joins it to the run. Where the
   * run doesn't take Steers, or hasn't said yet whether it does (#1250), it
   * waits in the queue instead, until the run ends.
   * Resolves `true` once the server has accepted it (or it's queued), `false`
   * when it was refused — the text is then held in `failedSend` for Retry or
   * Edit, never dropped.
   *
   * `retry` runs a failed turn again on its ask, which is still the chat's
   * last user message (#1228): nothing is added to the transcript, and a
   * refusal puts the error back with Retry rather than holding a new send.
   */
  async sendMessage(opts: SendMessageOptions, retry = false): Promise<boolean> {
    const { chatId } = opts
    const state = this.getOrCreate(chatId)
    if (!opts.message.trim()) return false
    this.askedHere.add(chatId)
    if (state.isStreaming) {
      if (state.steerable !== true) {
        this.enqueue(opts)
        return true
      }
      return this.sendSteer(opts)
    }

    // Optimistically add the user message. Kept by reference so a refusal
    // removes exactly this entry, even if the log moved on meanwhile.
    const optimistic: AgentMessage | null = retry
      ? null
      : userTurnMessage(opts.message)
    this.update(chatId, {
      error: null,
      failedSend: null,
      messages: optimistic ? [...state.messages, optimistic] : state.messages,
    })
    const dropOptimistic = () => ({
      messages: this.getOrCreate(chatId).messages.filter(
        (m) => m !== optimistic
      ),
    })

    try {
      const answer = await this.post(opts, retry)
      // A run this client hadn't heard of yet was working: the message joined
      // it (or waits for it) rather than starting a turn.
      if (answer.kind === "steered") {
        this.update(chatId, dropOptimistic())
        this.addPendingSteer(chatId, {
          key: answer.steerId,
          id: answer.steerId,
          message: opts.message,
          local: { draft: opts.draft },
        })
      } else if (answer.kind === "not-steerable") {
        this.update(chatId, { ...dropOptimistic(), steerable: false })
        this.enqueue(opts)
      } else {
        this.lastTurn.set(chatId, opts)
      }
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!this.getOrCreate(chatId).isStreaming) this.askedHere.delete(chatId)
      if (retry) {
        this.appendError(chatId, describeSendError(msg), msg, () =>
          this.sendMessage(opts, true)
        )
        return false
      }
      this.update(chatId, {
        error: msg,
        ...dropOptimistic(),
        failedSend: {
          message: opts.message,
          error: msg,
          draft: opts.draft,
          options: opts,
        },
      })
      return false
    }
  }

  /**
   * Send a message into the running turn as a Steer (#1190). It shows pending
   * straight away; the server's answer gives it its id, or says the run ended
   * meanwhile (the message started a turn, and its echo shows it) or can't be
   * steered (it waits in the queue).
   */
  private async sendSteer(opts: SendMessageOptions): Promise<boolean> {
    const { chatId } = opts
    const key = `s_${++steerSeq}`
    this.update(chatId, {
      error: null,
      failedSend: null,
      pendingSteers: [
        ...this.getOrCreate(chatId).pendingSteers,
        { key, message: opts.message, local: { draft: opts.draft } },
      ],
    })
    const without = () =>
      this.getOrCreate(chatId).pendingSteers.filter((p) => p.key !== key)

    try {
      const answer = await this.post(opts)
      if (answer.kind === "steered") {
        // The pending broadcast may have named it already.
        if (this.steerSettled(chatId, answer.steerId)) {
          this.update(chatId, { pendingSteers: without() })
        } else {
          this.update(chatId, {
            pendingSteers: this.getOrCreate(chatId).pendingSteers.map((p) =>
              p.key === key ? { ...p, id: answer.steerId } : p
            ),
          })
        }
      } else if (answer.kind === "not-steerable") {
        this.update(chatId, { pendingSteers: without(), steerable: false })
        this.enqueue(opts)
      } else {
        this.update(chatId, { pendingSteers: without() })
      }
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.update(chatId, {
        error: msg,
        pendingSteers: without(),
        failedSend: {
          message: opts.message,
          error: msg,
          draft: opts.draft,
          options: opts,
        },
      })
      return false
    }
  }

  /** POST a message to the stream route; throws when it's refused. */
  private async post(
    opts: SendMessageOptions,
    retry = false
  ): Promise<
    | { kind: "started" }
    | { kind: "steered"; steerId: string }
    | { kind: "not-steerable" }
  > {
    const res = await fetch(withBasePath("/api/agent/stream"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: opts.roomId,
        chatId: opts.chatId,
        ...wireTarget(opts.target),
        message: opts.message,
        isFirstChat: opts.isFirstChat,
        planMode: opts.planMode,
        model: opts.model,
        commentThreadIds: opts.commentThreadIds,
        retry: retry || undefined,
      }),
    })

    if (!res.ok) {
      if (res.status === 409) {
        const body = await res
          .clone()
          .json()
          .catch(() => null)
        if (body?.error === "not_steerable") return { kind: "not-steerable" }
        if (body?.error === "session_terminated") {
          throw new Error(
            "This chat's session has ended and can't be resumed. Please start a new chat to continue."
          )
        }
      }
      const errorText = await res.text()
      throw new Error(errorText || `HTTP ${res.status}`)
    }
    const body = await res.json().catch(() => null)
    return body?.steered && typeof body.steerId === "string"
      ? { kind: "steered", steerId: body.steerId }
      : { kind: "started" }
  }

  /** Hold a message until the running turn ends (a chat that can't steer). */
  private enqueue(opts: SendMessageOptions) {
    const { chatId } = opts
    this.update(chatId, {
      queued: [
        ...this.getOrCreate(chatId).queued,
        {
          id: `q_${++queueSeq}`,
          message: opts.message,
          draft: opts.draft,
          options: opts,
        },
      ],
    })
  }

  /** Send the refused message again, exactly as it was. */
  retryFailedSend(chatId: string): Promise<boolean> {
    const failed = this.getOrCreate(chatId).failedSend
    if (!failed) return Promise.resolve(false)
    this.update(chatId, { failedSend: null })
    return this.sendMessage(failed.options)
  }

  /**
   * Drop the refused message and hand it back, so the caller can put it in the
   * composer to edit.
   */
  takeFailedSend(chatId: string): FailedSend | null {
    const failed = this.getOrCreate(chatId).failedSend
    if (failed) this.update(chatId, { failedSend: null, error: null })
    return failed
  }

  /** Remove a queued message and hand it back (for Edit), or `null`. */
  takeQueued(chatId: string, id: string): QueuedMessage | null {
    const { queued } = this.getOrCreate(chatId)
    const item = queued.find((q) => q.id === id) ?? null
    if (item) this.update(chatId, { queued: queued.filter((q) => q !== item) })
    return item
  }

  /** Hand the Steers a stop gave back to the composer, clearing them. */
  takeReturnedSteers(chatId: string): ReturnedSteer[] {
    const { returnedSteers } = this.getOrCreate(chatId)
    if (returnedSteers.length > 0) this.update(chatId, { returnedSteers: [] })
    return returnedSteers
  }

  /** Send the next queued message, once the run it waited on has ended. */
  private drainQueue(chatId: string) {
    const { queued, isStreaming } = this.getOrCreate(chatId)
    if (isStreaming || queued.length === 0) return
    const [next, ...rest] = queued
    this.update(chatId, { queued: rest })
    void this.sendMessage(next.options)
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
      // back to clearing local streaming state so the user isn't stuck, and say
      // so in the transcript: the run may still be going on the server.
      const msg = e instanceof Error ? e.message : String(e)
      this.update(chatId, { isStreaming: false })
      this.appendError(chatId, "Couldn't stop the agent.", msg, () =>
        this.stopMessage(roomId, chatId)
      )
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
        // The run begins at its user message: the sender already shows it,
        // and everyone else gets its echo right after this.
        const { messages } = this.getOrCreate(chatId)
        const echoed = messages[messages.length - 1]?.role === "user"
        this.update(chatId, {
          isStreaming: true,
          runStart: Math.max(0, messages.length - (echoed ? 1 : 0)),
          // Not steerable until the run says it is.
          steerable: null,
        })
        break

      case "chat-stream-end": {
        // Only mark unread on the streaming→not-streaming transition so
        // duplicate end signals don't re-stick the badge after `markRead`
        // already cleared it.
        const wasStreaming = this.getOrCreate(chatId).isStreaming
        if (wasStreaming) this.unreadChats.add(chatId)
        this.acpAgentText.delete(chatId)
        this.acpThoughtText.delete(chatId)
        this.askedHere.delete(chatId)
        this.update(chatId, { isStreaming: false, runStart: null })
        this.drainQueue(chatId)
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
   * Apply a non-ACP control signal (ADR 0006): a plan resolution (flip the
   * matching plan card) or a turn error (surface it in chat). These have no ACP
   * slot, so they ride their own envelope rather than a `session/update`.
   * Auto-naming is not a control: the server writes names to the room doc.
   */
  private applyControl(chatId: string, control: ChatControlEvent) {
    switch (control.kind) {
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
      case "stopped": {
        const prev = this.getOrCreate(chatId).messages
        // A duplicate /stop (or a second subscriber) mustn't stack markers.
        if (prev[prev.length - 1]?.role === "stopped") break
        this.update(chatId, {
          messages: [...prev, { role: "stopped" as const }],
        })
        break
      }
      case "steerable":
        this.update(chatId, { steerable: control.steerable })
        break
      case "steer_pending":
        this.addPendingSteer(chatId, {
          key: control.steer.id,
          ...control.steer,
        })
        break
      case "steers_taken":
        this.settleSteers(chatId, control.ids, false)
        break
      case "steers_returned":
        this.settleSteers(
          chatId,
          control.steers.map((s) => s.id),
          true
        )
        break
      case "error":
        this.appendError(
          chatId,
          describeTurnError(control.message),
          control.message,
          this.turnRetry(chatId)
        )
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
   * late joiners append it fresh. The echo goes through the user-turn
   * projection, as a reload does, so both show the same message. It closes
   * any in-flight agent/thought block so the next agent delta starts a new
   * message.
   */
  private appendUserEcho(chatId: string, text: string) {
    this.acpAgentText.delete(chatId)
    this.acpThoughtText.delete(chatId)
    const prev = this.getOrCreate(chatId).messages
    const last = prev[prev.length - 1]
    const message = userTurnMessage(text)
    if (last?.role === "user" && last.content === message.content) return
    this.update(chatId, { messages: [...prev, message] })
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
    if (
      merged.status === "completed" &&
      existing?.status !== "completed" &&
      this.askedHere.has(chatId) &&
      bareToolName(merged.title) === "show_on_canvas"
    ) {
      viewRequests.emit({ chatId, ids: viewRequestIds(merged.rawInput) })
    }
    const message: AgentMessage = {
      role: "tool_call",
      toolCallId: merged.toolCallId,
      title: merged.title,
      kind: merged.kind,
      status: merged.status,
      content: merged.content,
      rawInput: merged.rawInput,
      parentToolCallId: merged.parentToolCallId,
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
      this.appendError(chatId, "Couldn't approve the plan.", msg, () =>
        this.approvePlan(roomId, chatId, planId)
      )
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
      this.appendError(chatId, "Couldn't reject the plan.", msg, () =>
        this.rejectPlan(roomId, chatId, planId, feedback)
      )
    }
  }

  // --- Transcript errors ---

  /**
   * Add an error to the transcript: `content` is the plain sentence shown,
   * `detail` the raw error kept for Copy error, and `retry` what Retry does.
   */
  private appendError(
    chatId: string,
    content: string,
    detail: string,
    retry?: () => Promise<unknown>
  ) {
    const message: AgentMessage = {
      role: "error",
      content,
      ...(detail && detail !== content ? { detail } : {}),
    }
    if (retry) this.errorRetries.set(message, retry)
    this.update(chatId, {
      error: detail || content,
      messages: [...this.getOrCreate(chatId).messages, message],
    })
  }

  /**
   * Retry for a failed turn: run it again on its message, when this client
   * sent it and it's still the last thing asked. The message stays the one
   * copy in the transcript (#1228). A turn someone else started (or a
   * Workspace's wake) has nothing here to retry.
   */
  private turnRetry(chatId: string): (() => Promise<unknown>) | undefined {
    const opts = this.lastTurn.get(chatId)
    if (!opts) return undefined
    const lastAsk = this.getOrCreate(chatId)
      .messages.filter((m) => m.role === "user")
      .at(-1)
    if (lastAsk?.content !== userTurnMessage(opts.message).content) {
      return undefined
    }
    return () => this.sendMessage({ ...opts }, true)
  }

  /** Whether an error in the transcript offers Retry. */
  canRetryError(message: AgentMessage): boolean {
    return this.errorRetries.has(message)
  }

  /** Retry what an error reports, taking the error out of the transcript. */
  async retryError(chatId: string, message: AgentMessage): Promise<void> {
    const retry = this.errorRetries.get(message)
    if (!retry) return
    this.errorRetries.delete(message)
    this.update(chatId, {
      error: null,
      messages: this.getOrCreate(chatId).messages.filter((m) => m !== message),
    })
    await retry()
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
    this.lastTurn.delete(chatId)
    this.unreadChats.delete(chatId)
    this.messagesEpoch.delete(chatId)
    this.appliedEventIds.delete(chatId)
    this.acpAgentText.delete(chatId)
    this.acpThoughtText.delete(chatId)
    this.settledSteers.delete(chatId)
    this.notify(chatId)
    this.listeners.delete(chatId)
  }
}

export const chatStore = new ChatStore()

// The screenshot harness has no agent to run, so in the Fixture World build it
// drives the chat's run states (streaming, stopped) by replaying the broadcast
// events a real run would send. `isFixtureWorld` is a compile-time constant
// and-ed with the local build, so no other build carries this handle.
if (isFixtureWorld && typeof window !== "undefined") {
  ;(window as unknown as { __chatStore?: ChatStore }).__chatStore = chatStore
}
