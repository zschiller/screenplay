"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react"
import { ClockIcon, FileTextIcon, XIcon } from "@workspace/ui/components/icons"
import { Spinner } from "@workspace/ui/components/spinner"
import { Button } from "@workspace/ui/components/button"
import { IconButton } from "@workspace/ui/components/icon-button"
import { GripSpinner } from "@/components/grip-spinner"
import { useAgentChat } from "@/hooks/use-agent-chat"
import { chatStore, sentTurn } from "@/lib/chat-store"
import { describeSendError } from "@/lib/agent/chat-errors"
import { RetryButton } from "@/components/home/load-error"
import {
  AgentMessageItem,
  FrameDriveGroup,
  TaskGroup,
  TurnSummaryRow,
} from "./agent-message"
import {
  foldFrameDrives,
  groupToolCalls,
  type GroupedMessage,
} from "@/lib/agent/group-tool-calls"
import {
  foldFinishedTurns,
  type TranscriptItem,
} from "@/lib/agent/turn-summary"
import { workspaceTasksOf } from "@/lib/agent/workspace-task"
import { userTurnToMessage, type UserTurn } from "@/lib/agent/user-turn"
import type { AgentMessage } from "@/lib/agent/types"
import type { CoordinatorStart } from "@/lib/fresh-workspace"
import type { ChatTarget } from "@/lib/chat/chat-target"
import {
  CHAT_CAPABILITIES,
  chatCapabilitiesOf,
  type ChatCapabilities,
} from "@/lib/chat/chat-capabilities"
import { workspaceLabel } from "@/lib/workspace-label"
import { useWorkspaceTasks } from "./workspace-task-row"
import { isHarnessPlumbing } from "@/lib/agent/tool-name"
import {
  Composer,
  type ComposerHandle,
  type ComposerSubmitPayload,
} from "./composer"
import type { SandboxStatus } from "@/lib/types"
import { inputStore } from "@/lib/input-store"
import { canvasViewSource } from "@/lib/canvas/canvas-view"
import { questionAnswers } from "@/lib/agent/question"
import { useChatSenders } from "@/hooks/use-chat-senders"
import { targetingStore } from "@/lib/targeting-store"
import { useModelCatalog } from "@/lib/use-model-catalog"
import {
  chatQuoteStore,
  quoteRangeLabel,
  withChatQuote,
  type ChatQuote,
} from "@/lib/chat-quote-store"
import { useMarkdownLayers } from "@/lib/yjs/react"

// Stable subscribe reference for `useSyncExternalStore` — a fresh closure each
// render would make React re-subscribe every render.
const subscribeTargetEligibility = (onChange: () => void) =>
  targetingStore.subscribeEligibility(onChange)

interface AgentChatProps {
  chatId: string
  roomId: string
  /** What this chat talks to: a Branch's sandbox, a document or the Room. */
  target: ChatTarget
  /** The branch's sandbox lifecycle status. While it's creating/starting the
   *  chat can't reach the agent yet, so we show the same provisioning spinner
   *  the terminal does rather than a live input that would error on send. */
  sandboxStatus?: SandboxStatus
  /** How the Coordinator's empty chat reads (#1182): a fresh canvas or not. */
  roomStart?: CoordinatorStart
  isFirstChat?: boolean
  planMode?: boolean
  onPlanModeChange?: (planMode: boolean) => void
  model?: string
  onModelChange?: (model: string) => void
  /** Whether this chat is the tab on screen. Only the visible chat marks its
   *  finished runs read; a background tab keeps its unread dot. */
  isActive?: boolean
  /**
   * Set on an earlier chat (#1315): one of the Workspace's chats from before a
   * Workspace had one chat. It stays readable, and in place of the composer it
   * points to the Workspace's chat, which this opens.
   */
  onOpenWorkspaceChat?: () => void
}

export function AgentChat({
  chatId,
  roomId,
  target,
  sandboxStatus,
  roomStart,
  isFirstChat,
  planMode,
  onPlanModeChange,
  model,
  onModelChange,
  isActive = true,
  onOpenWorkspaceChat,
}: AgentChatProps) {
  const {
    messages,
    isStreaming,
    runStart,
    isLoadingHistory,
    historyFailed,
    failedSend,
    queued,
    pendingSteers,
    steerable,
    returnedSteers,
    sendMessage,
    stopMessage,
    retryFailedSend,
    takeFailedSend,
    takeQueued,
    takeReturnedSteers,
    retryHistory,
    retryError,
  } = useAgentChat({
    chatId,
    roomId,
    target,
    isFirstChat,
    planMode,
    isActive,
  })
  const workspaceTasks = useWorkspaceTasks()

  // The model a send uses: this chat's own pick → the user's default from
  // Settings → the server default → first available (see `lib/model-catalog`).
  const { model: effectiveModel } = useModelCatalog(model)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<ComposerHandle>(null)

  const markdownLayers = useMarkdownLayers()

  // What the Composer offers and how the empty chat reads, for this chat's
  // Chat Target kind (skills, plan mode and element picking need a sandbox).
  const capabilities = chatCapabilitiesOf(target)

  // Keep the message list pinned to the bottom as content resolves —
  // react-markdown / code blocks / streaming tokens all change the height
  // asynchronously, so a single scrollTo after a `messages` update lands
  // short of the new bottom. A ResizeObserver on the content wrapper catches
  // every height change (growth *and* shrink) and re-pins.
  //
  // This follows the model proven by AI-chat scroll libraries such as
  // `use-stick-to-bottom`, distilled to two rules:
  //
  //  1. Pin *instantly* (`scrollTop = scrollHeight`), never with native
  //     `behavior: "smooth"`. A smooth scroll animates toward a target that
  //     streaming has already made stale, so it perpetually trails the bottom
  //     and `scrollTop` lags during the animation. (The libraries replace it
  //     with their own velocity spring; instant is the simpler safe choice and
  //     matches ChatGPT/Claude, where the smoothness comes from tokens arriving
  //     incrementally, not from scroll easing.)
  //
  //  2. Decide whether to keep following (`stick`) from the *user's input
  //     gesture*, never from `scrollTop` deltas. The browser moves `scrollTop`
  //     on its own — most importantly it clamps it downward when content
  //     shrinks (a code fence closing, a thinking/tool-call row collapsing),
  //     emitting a scroll event indistinguishable from a manual scroll-up. A
  //     wheel-up is therefore the unpin signal: it fires synchronously, before
  //     the next resize can yank the view back, so the user can read history
  //     mid-stream. The scroll handler only supplies steady-state truth —
  //     re-pinning once the viewport is back within THRESHOLD of the bottom
  //     (covers scrollbar drags and keyboard paging too).
  useEffect(() => {
    const container = scrollContainerRef.current
    const content = scrollContentRef.current
    if (!container || !content) return
    const THRESHOLD = 64
    let stick = true
    const distanceFromBottom = () =>
      container.scrollHeight - container.scrollTop - container.clientHeight

    // Wheel/touch up = the user is leaving the bottom on purpose. Set synchronously
    // so an in-flight stream can't re-pin us before the intent registers.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) stick = false
    }
    let lastTouchY = 0
    const onTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY ?? 0
    }
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0
      if (y > lastTouchY) stick = false // finger down → content scrolls up
      lastTouchY = y
    }
    // Steady-state truth: wherever the scroll settles, follow iff near the bottom.
    const onScroll = () => {
      stick = distanceFromBottom() <= THRESHOLD
    }
    container.addEventListener("wheel", onWheel, { passive: true })
    container.addEventListener("touchstart", onTouchStart, { passive: true })
    container.addEventListener("touchmove", onTouchMove, { passive: true })
    container.addEventListener("scroll", onScroll, { passive: true })

    let lastClientHeight = 0
    const observer = new ResizeObserver(() => {
      const clientHeight = container.clientHeight
      if (clientHeight === 0) {
        lastClientHeight = 0
        return
      }
      // First reveal (mount, or the panel expanding from a collapsed 0px state)
      // always jumps to the bottom; later changes only when still pinned.
      const isFirstReveal = lastClientHeight === 0
      lastClientHeight = clientHeight
      if (!isFirstReveal && !stick) return
      container.scrollTop = container.scrollHeight
    })
    observer.observe(content)
    observer.observe(container)
    return () => {
      observer.disconnect()
      container.removeEventListener("wheel", onWheel)
      container.removeEventListener("touchstart", onTouchStart)
      container.removeEventListener("touchmove", onTouchMove)
      container.removeEventListener("scroll", onScroll)
    }
  }, [])

  // Picking a model here changes only this chat, from its next turn on (the
  // server re-reads the model every turn); the default lives in Settings.
  const handleModelChange = useCallback(
    (m: string) => onModelChange?.(m),
    [onModelChange]
  )

  // The Composer serializes the draft to a Message-Markers wire body and hands
  // it back here with the chosen model; the chat just relays it to the engine.
  // A chat still following the default is pinned to the model it first sends
  // with, so changing the default later never relabels a running session.
  const handleSubmit = useCallback(
    ({ text, turn, model: submitted, draft }: ComposerSubmitPayload) => {
      if (!model && submitted) onModelChange?.(submitted)
      // A passage quoted by Reply in chat (#1243) leads both the wire body and
      // the body the chat draws, the way a reload projects it from the wire.
      const quote = chatQuoteStore.take(chatId)
      void sendMessage(quote ? withChatQuote(quote, text) : text, {
        model: submitted,
        turn: quote ? { ...turn, body: withChatQuote(quote, turn.body) } : turn,
        draft,
        // What "this" means: the sender's selection and screen right now.
        canvasView: canvasViewSource.read(),
      })
    },
    [sendMessage, model, onModelChange, chatId]
  )

  // Reply in chat (#1243) quotes into the chat on screen: this one while it's
  // the visible tab. A new quote focuses the composer (its `focusKey`) so the
  // question can be typed straight away.
  useEffect(() => {
    if (!isActive) return
    return chatQuoteStore.claimForeground(chatId)
  }, [chatId, isActive])
  const quote = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => chatQuoteStore.subscribe(chatId, onChange),
      [chatId]
    ),
    () => chatQuoteStore.get(chatId),
    () => undefined
  )

  // Put a held message (refused or queued) back in the composer to edit. The
  // composer's own document restores mentions and element tokens intact; a
  // message sent from outside the composer has only its text.
  const restoreToComposer = useCallback(
    (held: { message: string; draft?: unknown } | null) => {
      if (!held) return
      if (held.draft) composerRef.current?.restoreDraft(held.draft)
      else composerRef.current?.insertText(held.message)
    },
    []
  )

  // Steers a stop handed back go into the composer to send again or drop
  // (#1190), the way an edited queued message does.
  useEffect(() => {
    if (returnedSteers.length === 0) return
    for (const steer of takeReturnedSteers()) restoreToComposer(steer)
  }, [returnedSteers, takeReturnedSteers, restoreToComposer])

  // Element targeting (PRD #616): agent chats in a room can target this branch's
  // own preview frames. The Composer's target icon / ⌘E calls this, which asks
  // the Canvas (through the targeting store) to run a one-shot crosshair pick
  // over the eligible frames and resolves with the picked element — or null when
  // cancelled or when no Canvas is mounted (doc chats, the seed composer).
  //
  // The pick key is a **Branch id**: Element Targeting's eligibility rule
  // matches it against each frame's `branchId`.
  const { pickBranchId } = capabilities
  const handlePickElement = useCallback(() => {
    if (!pickBranchId) return Promise.resolve(null)
    return targetingStore.requestPick(pickBranchId)
  }, [pickBranchId])

  // Whether this branch has an eligible frame open right now — the Canvas
  // publishes it, and it drives the composer target icon's disabled/tooltip
  // state (#619). Subscribed here (not in the leaf Composer) so the Composer
  // stays a generic input with no store dependency.
  const targetEligible = useSyncExternalStore(
    subscribeTargetEligibility,
    () =>
      pickBranchId ? targetingStore.hasEligibleFrames(pickBranchId) : false,
    () => false
  )

  // Allow other parts of the app (e.g. the inspect tool) to append text
  // snippets to this chat's draft.
  useEffect(() => {
    return inputStore.subscribe(chatId, (text) => {
      composerRef.current?.insertText(text)
    })
  }, [chatId])

  // Allow shortcut actions (e.g. the Create PR button) to send a message directly.
  useEffect(() => {
    return inputStore.subscribeSend(chatId, (text) => {
      if (!model && effectiveModel) onModelChange?.(effectiveModel)
      void sendMessage(text, { model: effectiveModel })
    })
  }, [chatId, sendMessage, effectiveModel, model, onModelChange])

  // Question cards (#1312) close once a user message follows them.
  const answers = useMemo(() => questionAnswers(messages), [messages])
  // On a shared Canvas, messages and answers name who sent them.
  const senders = useChatSenders(roomId, messages)

  // While the sandbox is still booting there's no agent to talk to yet — show
  // the same provisioning spinner the terminal does (terminal-tab.tsx) instead
  // of a live composer whose first send would just error. Mirrors the copy and
  // Spinner so a freshly-seeded chat tab and terminal tab read identically.
  if (sandboxStatus === "creating" || sandboxStatus === "starting") {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background px-6 text-center text-sm text-balance text-muted-foreground">
        <span className="flex items-center gap-2">
          <Spinner className="size-4" /> The workspace is still starting…
        </span>
      </div>
    )
  }

  const lastRole = messages[messages.length - 1]?.role
  // A Coordinator turn answering a wake (#897) works out of sight, so its cue
  // names the Workspace it's catching up on instead of "Thinking…".
  const wakeFrom = isStreaming ? runningWakeFrom(messages) : undefined
  const wakeBranch = wakeFrom
    ? workspaceTasks?.branches.find((b) => b.id === wakeFrom)
    : undefined

  const renderEntry = ({
    message: msg,
    index: i,
    children,
    drive,
  }: GroupedMessage) =>
    drive ? (
      <FrameDriveGroup key={i} steps={children.map((c) => c.message)} />
    ) : // A subagent's calls fold under the Task that spawned them (#640);
    // `children` is non-empty only for such a Task.
    children.length > 0 && msg.role === "tool_call" ? (
      <TaskGroup
        key={i}
        task={msg}
        childCalls={children.map((c) => c.message)}
      />
    ) : (
      <AgentMessageItem
        key={i}
        message={msg}
        roomId={roomId}
        chatId={chatId}
        questionAnswer={
          msg.role === "tool_call" ? answers.get(msg.toolCallId) : undefined
        }
        senders={senders}
        // Retry only while the error is the last thing in the chat: once the
        // conversation has moved on, redoing it would act out of turn.
        onRetry={
          msg === messages[messages.length - 1] &&
          !isStreaming &&
          chatStore.canRetryError(msg)
            ? () => retryError(msg)
            : undefined
        }
      />
    )

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div ref={scrollContentRef} className="flex min-h-full flex-col p-3">
          {isLoadingHistory ? (
            <div className="m-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <Spinner className="size-3" />
              Loading chat…
            </div>
          ) : historyFailed && messages.length === 0 && !failedSend ? (
            <ChatLoadError onRetry={retryHistory} />
          ) : messages.length === 0 && !failedSend ? (
            <ChatEmptyState
              capabilities={capabilities}
              roomStart={roomStart}
              onPickStarter={(text) => composerRef.current?.insertText(text)}
            />
          ) : (
            <div className="space-y-4">
              {stackTaskRows(
                foldFinishedTurns(
                  foldFrameDrives(
                    groupToolCalls(
                      // Every chat leaves out a harness's own plumbing.
                      messages.filter((m) => !isHarnessPlumbing(m))
                    )
                  ),
                  {
                    streaming: isStreaming,
                    liveFrom: runStart,
                  }
                ),
                workspaceTasks != null
              ).map((item) =>
                item.kind === "turn-summary" ? (
                  <TurnSummaryRow
                    key={`summary-${item.index}`}
                    summary={item.summary}
                  >
                    {item.steps.map((entry) => renderEntry(entry))}
                  </TurnSummaryRow>
                ) : item.kind === "task-rows" ? (
                  <div
                    key={`tasks-${item.entries[0].index}`}
                    className="flex flex-col gap-1"
                  >
                    {item.entries.map((entry) => renderEntry(entry))}
                  </div>
                ) : (
                  renderEntry(item.entry)
                )
              )}
              {/* The run's in-progress cue, held until the run settles. Before
                  any text streams (and between tool calls) it says "Thinking…";
                  once the assistant is writing, the grid alone trails the
                  message, so the reply never looks finished while it grows. */}
              {isStreaming && (
                <div
                  role="status"
                  data-testid="run-in-progress"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <GripSpinner className="size-3" />
                  {lastRole === "assistant" ? (
                    <span className="sr-only">Responding…</span>
                  ) : wakeFrom ? (
                    wakeBranch ? (
                      `Catching up on ${workspaceLabel(wakeBranch)}…`
                    ) : (
                      "Catching up…"
                    )
                  ) : (
                    "Thinking…"
                  )}
                </div>
              )}
              {pendingSteers.map((steer) => (
                <PendingSteerNotice
                  key={steer.key}
                  turn={steer.turn}
                  roomId={roomId}
                  chatId={chatId}
                />
              ))}
              {failedSend && (
                <FailedSendNotice
                  turn={sentTurn(failedSend.options)}
                  error={failedSend.error}
                  roomId={roomId}
                  chatId={chatId}
                  onRetry={() => void retryFailedSend()}
                  onEdit={() => restoreToComposer(takeFailedSend())}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Input. An earlier chat is read-only (#1315): only the Workspace's
          own chat sends. */}
      {onOpenWorkspaceChat ? (
        <div className="flex items-center gap-3 border-t border-border p-3 text-sm text-muted-foreground">
          <p className="min-w-0 flex-1 text-balance">
            An earlier chat, kept to read. Work continues in the newest chat.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onOpenWorkspaceChat}
          >
            Open chat
          </Button>
        </div>
      ) : (
        <Composer
          ref={composerRef}
          markdownLayers={markdownLayers}
          // The `/` menu lists this Branch's merged App ∪ Repo Skills, fetched
          // when the chat opens (so reopening after editing a Repo Skill
          // refreshes it); Document and Coordinator chats have no Skills.
          skillSource={
            capabilities.skills
              ? { sandboxName: capabilities.skillSandboxName }
              : undefined
          }
          model={model}
          onModelChange={handleModelChange}
          planMode={planMode}
          onPlanModeChange={
            capabilities.planMode ? onPlanModeChange : undefined
          }
          onSubmit={handleSubmit}
          isStreaming={isStreaming}
          onStop={stopMessage}
          queueWhileStreaming
          steersWhileStreaming={steerable}
          draftKey={chatId}
          placeholder={capabilities.placeholder}
          aboveInput={
            queued.length > 0 ? (
              <ul aria-label="Queued messages" className="mb-2 space-y-1">
                {queued.map((q) => (
                  <QueuedRow
                    key={q.id}
                    message={q.message}
                    onEdit={() => restoreToComposer(takeQueued(q.id))}
                    onRemove={() => takeQueued(q.id)}
                  />
                ))}
              </ul>
            ) : undefined
          }
          inputHeader={
            quote ? (
              <QuoteRow
                quote={quote}
                onRemove={() => chatQuoteStore.remove(chatId)}
              />
            ) : undefined
          }
          onPickElement={pickBranchId ? handlePickElement : undefined}
          targetEligible={targetEligible}
          focusKey={quote?.key}
        />
      )}
    </div>
  )
}

/**
 * The empty chat, worded for its Chat Target (see `lib/chat/chat-capabilities`).
 * On a fresh canvas (#1182) the Coordinator asks what should change instead,
 * and says where the first ask runs. A starter fills the composer rather than
 * sending, so it can be edited first.
 */
function ChatEmptyState({
  capabilities,
  roomStart,
  onPickStarter,
}: {
  capabilities: ChatCapabilities
  /** Given only to the Coordinator's chat. */
  roomStart?: CoordinatorStart
  onPickStarter: (text: string) => void
}) {
  const fresh = roomStart?.kind === "fresh"
  // With no repository the Coordinator starts chats with none, which make
  // Mockups and Documents, so its empty chat offers those asks.
  const noRepository = roomStart?.kind === "no-repository"
  const starters = fresh
    ? []
    : noRepository
      ? CHAT_CAPABILITIES.sketch.starters
      : capabilities.starters
  return (
    <div className="m-auto flex max-w-64 flex-col items-center gap-3 text-center text-balance">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {fresh
            ? roomStart.repoName
              ? `What should change in ${roomStart.repoName}?`
              : "What should change?"
            : noRepository
              ? "Sketch or write something"
              : capabilities.emptyTitle}
        </p>
        <p className="text-xs text-muted-foreground">
          {fresh
            ? "Your first ask runs in the workspace on the canvas."
            : noRepository
              ? "Ask for a mockup or a document and a chat starts to make it."
              : capabilities.emptyBody}
        </p>
      </div>
      {starters.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {starters.map((text) => (
            <Button
              key={text}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onPickStarter(text)}
              className="font-normal text-muted-foreground hover:text-foreground"
            >
              {text}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * A chat whose history didn't load: said in the empty chat's own size and
 * place, so a failed load never reads as a chat with nothing in it.
 */
function ChatLoadError({ onRetry }: { onRetry: () => Promise<unknown> }) {
  return (
    <div
      role="alert"
      className="m-auto flex max-w-64 flex-col items-center gap-3 text-center text-balance"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          Couldn&apos;t load this chat
        </p>
        <p className="text-xs text-muted-foreground">
          Its messages are still saved. Try loading them again.
        </p>
      </div>
      <RetryButton onRetry={onRetry} />
    </div>
  )
}

/**
 * A message the server refused, kept where it was sent with Retry and Edit so
 * no typed text is lost (#802).
 */
function FailedSendNotice({
  turn,
  error,
  roomId,
  chatId,
  onRetry,
  onEdit,
}: {
  turn: UserTurn
  error: string
  roomId: string
  chatId: string
  onRetry: () => void
  onEdit: () => void
}) {
  return (
    <div className="flex flex-col items-end gap-1" data-testid="failed-send">
      <div className="w-full">
        <AgentMessageItem
          message={userTurnToMessage(turn)}
          roomId={roomId}
          chatId={chatId}
        />
      </div>
      <div className="-mr-2 flex max-w-full items-center text-xs">
        <span className="mr-2 min-w-0 truncate text-destructive" title={error}>
          Not sent: {describeSendError(error)}
        </span>
        <Button variant="ghost" size="xs" onClick={onRetry}>
          Retry
        </Button>
        <Button variant="ghost" size="xs" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </div>
  )
}

/**
 * A message sent while the agent works, waiting for it to take it at its next
 * step (#1190). Drawn like the user message it becomes, dimmed, at the end of
 * the log; once taken it moves to where the agent took it.
 */
function PendingSteerNotice({
  turn,
  roomId,
  chatId,
}: {
  turn: UserTurn
  roomId: string
  chatId: string
}) {
  return (
    <div className="flex flex-col items-end gap-1" data-testid="pending-steer">
      <div className="w-full opacity-60">
        <AgentMessageItem
          message={userTurnToMessage(turn)}
          roomId={roomId}
          chatId={chatId}
        />
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <ClockIcon className="size-3.5 shrink-0" />
        Waiting for the agent
      </div>
    </div>
  )
}

/** One message waiting for the current run to end. */
function QueuedRow({
  message,
  onEdit,
  onRemove,
}: {
  message: string
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <li className="flex items-center gap-1.5 rounded-lg bg-muted/60 py-1 pr-1 pl-2.5 text-xs dark:bg-input/50">
      <ClockIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-muted-foreground">Queued</span>
      <span className="min-w-0 flex-1 truncate" title={message}>
        {message}
      </span>
      <Button variant="ghost" size="xs" onClick={onEdit}>
        Edit
      </Button>
      <IconButton label="Remove from queue" onClick={onRemove}>
        <XIcon />
      </IconButton>
    </li>
  )
}

/**
 * The Document passage Reply in chat quoted (#1243), at the top of the input
 * box until the next send takes it: the Document and line range, then up to three lines of
 * the text. The X drops it.
 */
function QuoteRow({
  quote,
  onRemove,
}: {
  quote: ChatQuote
  onRemove: () => void
}) {
  const range = quoteRangeLabel(quote)
  return (
    <div
      aria-label="Quoted passage"
      className="flex w-full gap-1.5 rounded-lg bg-muted/60 py-1 pr-1 pl-2.5 text-xs dark:bg-input/50"
    >
      <FileTextIcon className="mt-1.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 py-1">
        <div className="truncate font-medium">
          {quote.documentTitle ? `${quote.documentTitle} · ${range}` : range}
        </div>
        <div className="mt-0.5 line-clamp-3 break-words whitespace-pre-wrap text-muted-foreground">
          {quote.quotedText}
        </div>
      </div>
      <IconButton label="Remove quote" onClick={onRemove}>
        <XIcon />
      </IconButton>
    </div>
  )
}

/**
 * The Workspace a running Coordinator turn is catching up on, when the turn
 * answers a wake (#897): the last user message's wake.
 */
function runningWakeFrom(messages: AgentMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === "user") return message.wakeFrom
  }
  return undefined
}

/**
 * Stack back-to-back Workspace task rows (#896) as one list, so the rows of
 * a Coordinator's delegations sit together rather than a message gap apart.
 * Only the Coordinator panel draws task rows; elsewhere this is a no-op.
 */
function stackTaskRows(
  items: TranscriptItem[],
  drawsTaskRows: boolean
): (TranscriptItem | { kind: "task-rows"; entries: GroupedMessage[] })[] {
  if (!drawsTaskRows) return items
  const out: (
    TranscriptItem | { kind: "task-rows"; entries: GroupedMessage[] }
  )[] = []
  for (const item of items) {
    const message = item.kind === "message" ? item.entry.message : null
    const isTaskRow =
      message?.role === "tool_call" && workspaceTasksOf(message).length > 0
    const prev = out[out.length - 1]
    if (item.kind === "message" && isTaskRow) {
      if (prev?.kind === "task-rows") prev.entries.push(item.entry)
      else out.push({ kind: "task-rows", entries: [item.entry] })
    } else out.push(item)
  }
  return out
}
