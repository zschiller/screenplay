"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { getSkillMenuItems, type SkillMenuItem } from "@/lib/skills-store"
import { ClockIcon, XIcon } from "@workspace/ui/components/icons"
import { Spinner } from "@workspace/ui/components/spinner"
import { Button } from "@workspace/ui/components/button"
import { IconButton } from "@workspace/ui/components/icon-button"
import { GripSpinner } from "@/components/grip-spinner"
import { useAgentChat } from "@/hooks/use-agent-chat"
import { chatStore } from "@/lib/chat-store"
import { describeSendError } from "@/lib/agent/chat-errors"
import { RetryButton } from "@/components/home/load-error"
import { AgentMessageItem, TaskGroup, TurnSummaryRow } from "./agent-message"
import {
  groupToolCalls,
  type GroupedMessage,
} from "@/lib/agent/group-tool-calls"
import {
  foldFinishedTurns,
  type TranscriptItem,
} from "@/lib/agent/turn-summary"
import { workspaceTasksOf } from "@/lib/agent/workspace-task"
import { parseUserMessage } from "@/lib/agent/message-markers"
import type { AgentMessage } from "@/lib/agent/types"
import type { CoordinatorStart } from "@/lib/fresh-workspace"
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
import { targetingStore } from "@/lib/targeting-store"
import {
  getDefaultModelId,
  getModels,
  type ModelInfo,
} from "@/lib/models-store"
import { resolveDefaultModel } from "@/lib/model-selection"
import { useDefaultModel } from "@/lib/default-model-store"
import { useMarkdownLayers } from "@/lib/yjs/react"

// Stable subscribe reference for `useSyncExternalStore` — a fresh closure each
// render would make React re-subscribe every render.
const subscribeTargetEligibility = (onChange: () => void) =>
  targetingStore.subscribeEligibility(onChange)

interface AgentChatProps {
  chatId: string
  roomId: string
  /** Sandbox-backed target. Either this or `markdownLayerId` is set. */
  sandboxId?: string
  sandboxName?: string
  /** The branch's sandbox lifecycle status. While it's creating/starting the
   *  chat can't reach the agent yet, so we show the same provisioning spinner
   *  the terminal does rather than a live input that would error on send. */
  sandboxStatus?: SandboxStatus
  /** Document-layer target. */
  markdownLayerId?: string
  /** The Room's Coordinator chat: the whole canvas, no sandbox or document. */
  roomTarget?: boolean
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
}

export function AgentChat({
  chatId,
  roomId,
  sandboxId,
  sandboxName,
  sandboxStatus,
  markdownLayerId,
  roomTarget,
  roomStart,
  isFirstChat,
  planMode,
  onPlanModeChange,
  model,
  onModelChange,
  isActive = true,
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
    sandboxName,
    markdownLayerId,
    roomTarget,
    isFirstChat,
    planMode,
    isActive,
  })
  const workspaceTasks = useWorkspaceTasks()

  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [modelsFailed, setModelsFailed] = useState(false)
  // Bumped by Retry on a failed model list, to fetch it again.
  const [modelsAttempt, setModelsAttempt] = useState(0)
  const [serverDefaultModel, setServerDefaultModel] = useState<string | null>(
    null
  )
  // The user's default from Settings, live so a change there reaches an open
  // chat that hasn't picked its own model yet.
  const userDefaultModel = useDefaultModel()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<ComposerHandle>(null)

  const markdownLayers = useMarkdownLayers()

  // Sandbox-backed Agent chat vs. a Document (Markdown-Layer) or Coordinator
  // (Room) chat. Neither of those has a sandbox, so three composer affordances
  // that only make sense against a sandbox are switched off for them:
  //
  //   - the `/` skill menu — nothing to enumerate, no `read_skill` tool, so `/`
  //     stays a literal slash;
  //   - the Plan toggle — the Document toolset has no `submit_plan` gate, so a
  //     plan-mode turn would change nothing (#743);
  //   - element picking — there's no preview to pick from.
  //
  // The empty-state copy below splits on the same flag.
  const chatKind: ChatKind = roomTarget
    ? "room"
    : markdownLayerId
      ? "document"
      : "agent"
  const isAgentChat = chatKind === "agent"
  const composerPlaceholder = isAgentChat
    ? "Ask the agent… (@ document, / skill)"
    : chatKind === "room"
      ? "Ask the Coordinator… (@ to mention a document)"
      : "Ask the agent… (@ to mention a document)"

  // Merged App ∪ Repo Skill index for the `/` menu, fetched once on chat open
  // (see effect below) and handed to the Composer. `skillsLoading` drives the
  // menu's loading state until the per-Branch index lands.
  const [skills, setSkills] = useState<SkillMenuItem[]>([])
  const [skillsLoading, setSkillsLoading] = useState(true)

  // Flip the loading flag on as soon as a new skill fetch is about to start,
  // using the render-phase previous-value pattern (react.dev "You Might Not
  // Need an Effect") so we avoid a synchronous setState inside the effect
  // below; that effect performs the fetch and clears the flag from its async
  // callback. Keyed by sandbox so a re-fetch (e.g. reopening after editing a
  // Repo Skill) shows the spinner again. Document chats don't fetch, so their
  // key is null and the flag never flips on.
  const skillsFetchKey = isAgentChat ? `${sandboxName ?? ""}` : null
  const [prevSkillsFetchKey, setPrevSkillsFetchKey] = useState<string | null>(
    null
  )
  if (skillsFetchKey !== prevSkillsFetchKey) {
    setPrevSkillsFetchKey(skillsFetchKey)
    if (skillsFetchKey !== null) setSkillsLoading(true)
  }

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

  useEffect(() => {
    let cancelled = false
    Promise.all([getModels(), getDefaultModelId()])
      .then(([list, def]) => {
        if (cancelled) return
        setModels(list)
        setServerDefaultModel(def)
        setModelsFailed(false)
        // Only a fetch that answered can say the catalog is empty — the
        // desktop "no agent detected" state. A failed one says so instead.
        setModelsLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setModelsFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [modelsAttempt])

  // Load the merged App ∪ Repo Skill index once on chat open (Agent chats
  // only). Keyed by sandbox so reopening after editing a Repo Skill refetches
  // the Branch's current list.
  useEffect(() => {
    if (!isAgentChat) return undefined
    let cancelled = false
    getSkillMenuItems(sandboxName)
      .then((items) => {
        if (!cancelled) setSkills(items)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSkillsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isAgentChat, sandboxName])

  // Precedence: per-chat override (set by `onModelChange`) → the user's
  // default from Settings → server-side default for the configured provider
  // set → first available. See `resolveDefaultModel`.
  const defaultModel = resolveDefaultModel({
    stored: userDefaultModel,
    serverDefault: serverDefaultModel,
    models,
  })
  const effectiveModel = resolveDefaultModel({
    perSession: model,
    stored: userDefaultModel,
    serverDefault: serverDefaultModel,
    models,
  })

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
    ({ text, model: submitted, draft }: ComposerSubmitPayload) => {
      if (!model && submitted) onModelChange?.(submitted)
      void sendMessage(text, { model: submitted, draft })
    },
    [sendMessage, model, onModelChange]
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
  // The pick key is a **Branch id**: this chat's `sandboxId` prop is the
  // sandbox-backed agent's id, which *is* its Branch's id (`agent.id`), and
  // Element Targeting's eligibility rule matches it against each frame's
  // `branchId`. Named here so the two ids aren't mistaken for different keys.
  const pickBranchId = sandboxId
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

  // While the sandbox is still booting there's no agent to talk to yet — show
  // the same provisioning spinner the terminal does (terminal-tab.tsx) instead
  // of a live composer whose first send would just error. Mirrors the copy and
  // Spinner so a freshly-seeded chat tab and terminal tab read identically.
  if (sandboxStatus === "creating" || sandboxStatus === "starting") {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background px-6 text-center text-sm text-balance text-muted-foreground">
        <span className="flex items-center gap-2">
          <Spinner className="size-4" /> Waiting for the sandbox to start…
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

  const renderEntry = ({ message: msg, index: i, children }: GroupedMessage) =>
    // A subagent's calls fold under the Task that spawned them (#640);
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
              kind={chatKind}
              roomStart={roomStart}
              onPickStarter={(text) => composerRef.current?.insertText(text)}
            />
          ) : (
            <div className="space-y-4">
              {stackTaskRows(
                foldFinishedTurns(
                  groupToolCalls(
                    // The Coordinator's chat leaves out a harness's own
                    // plumbing (loading our MCP tools); a Workspace's keeps it.
                    workspaceTasks
                      ? messages.filter((m) => !isHarnessPlumbing(m))
                      : messages
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
                      "Catching up on a Workspace…"
                    )
                  ) : (
                    "Thinking…"
                  )}
                </div>
              )}
              {pendingSteers.map((steer) => (
                <PendingSteerNotice
                  key={steer.key}
                  message={steer.message}
                  roomId={roomId}
                  chatId={chatId}
                />
              ))}
              {failedSend && (
                <FailedSendNotice
                  message={failedSend.message}
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

      {/* Input */}
      <Composer
        ref={composerRef}
        markdownLayers={markdownLayers}
        skills={skills}
        skillsLoading={skillsLoading}
        enableSkills={isAgentChat}
        models={models}
        modelsLoaded={modelsLoaded}
        modelsFailed={modelsFailed}
        onRetryModels={() => setModelsAttempt((n) => n + 1)}
        model={effectiveModel}
        defaultModel={defaultModel}
        onModelChange={handleModelChange}
        planMode={planMode}
        onPlanModeChange={isAgentChat ? onPlanModeChange : undefined}
        onSubmit={handleSubmit}
        isStreaming={isStreaming}
        onStop={stopMessage}
        queueWhileStreaming
        steersWhileStreaming={steerable}
        draftKey={chatId}
        placeholder={composerPlaceholder}
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
        onPickElement={isAgentChat && sandboxId ? handlePickElement : undefined}
        targetEligible={targetEligible}
      />
    </div>
  )
}

/** Starter prompts per Chat Target: a nudge at the kind of ask that works. */
const FRAME_STARTERS = [
  "Explain how this page is built",
  "Tighten the spacing on mobile",
  "Add a loading state",
]
const DOCUMENT_STARTERS = [
  "Tighten the wording",
  "Add a summary at the top",
  "Turn this into a checklist",
]
const ROOM_STARTERS = [
  "What's on this canvas?",
  "Which Workspaces have a PR?",
  "What changed in each Workspace?",
]

/** Which Chat Target a chat talks to, in the UI's terms. */
type ChatKind = "agent" | "document" | "room"

/**
 * The empty chat, worded for its Chat Target in the UI's own nouns: a frame
 * chat changes the Workspace's code (and so what its frames show), a Document
 * chat edits the Document, the Coordinator sees the whole canvas. On a fresh
 * canvas (#1182) the Coordinator asks what should change instead, and says
 * where the first ask runs. A starter fills the composer rather than sending,
 * so it can be edited first.
 */
function ChatEmptyState({
  kind,
  roomStart,
  onPickStarter,
}: {
  kind: ChatKind
  roomStart?: CoordinatorStart
  onPickStarter: (text: string) => void
}) {
  const fresh = kind === "room" && roomStart?.kind === "fresh"
  const starters = fresh
    ? []
    : kind === "agent"
      ? FRAME_STARTERS
      : kind === "room"
        ? ROOM_STARTERS
        : DOCUMENT_STARTERS
  return (
    <div className="m-auto flex max-w-64 flex-col items-center gap-3 text-center text-balance">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {fresh
            ? roomStart.repoName
              ? `What should change in ${roomStart.repoName}?`
              : "What should change?"
            : kind === "agent"
              ? "Change what your frames show"
              : kind === "room"
                ? "Ask about this canvas"
                : "Edit this Document"}
        </p>
        <p className="text-xs text-muted-foreground">
          {fresh
            ? "Your first ask runs in the Workspace on the canvas."
            : kind === "room"
              ? "The Coordinator sees every Workspace, frame and Document on this canvas."
              : kind === "agent"
                ? "The agent edits this Workspace's code and can run commands, and your frames update as it works."
                : "The agent can rewrite and retitle it, and read any Document you @ mention."}
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
  message,
  error,
  roomId,
  chatId,
  onRetry,
  onEdit,
}: {
  message: string
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
          message={{ role: "user", content: message }}
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
  message,
  roomId,
  chatId,
}: {
  message: string
  roomId: string
  chatId: string
}) {
  return (
    <div className="flex flex-col items-end gap-1" data-testid="pending-steer">
      <div className="w-full opacity-60">
        <AgentMessageItem
          message={{ role: "user", content: message }}
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
 * The Workspace a running Coordinator turn is catching up on, when the turn
 * answers a wake (#897): read from the last user message's marker.
 */
function runningWakeFrom(messages: AgentMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === "user") {
      return parseUserMessage(message.content).wakeFrom
    }
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
    | TranscriptItem
    | { kind: "task-rows"; entries: GroupedMessage[] }
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
