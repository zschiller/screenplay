"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { getSkillMenuItems, type SkillMenuItem } from "@/lib/skills-store"
import { Spinner } from "@workspace/ui/components/spinner"
import { GripSpinner } from "@/components/grip-spinner"
import { useAgentChat } from "@/hooks/use-agent-chat"
import { AgentMessageItem } from "./agent-message"
import {
  Composer,
  type ComposerHandle,
  type ComposerSubmitPayload,
} from "./composer"
import type { AgentMessage } from "@/lib/agent/types"
import type { SandboxStatus } from "@/lib/types"
import { inputStore } from "@/lib/input-store"
import { targetingStore } from "@/lib/targeting-store"
import {
  getDefaultModelId,
  getModels,
  type ModelInfo,
} from "@/lib/models-store"
import { resolveDefaultModel } from "@/lib/model-selection"
import { useMarkdownLayers } from "@/lib/yjs/react"

const LAST_MODEL_STORAGE_KEY = "agent-last-model"

function readStoredModel(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(LAST_MODEL_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredModel(modelId: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(LAST_MODEL_STORAGE_KEY, modelId)
  } catch {}
}

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
  branch?: string
  /** Document-layer target. */
  markdownLayerId?: string
  isFirstChat?: boolean
  autoNamedBranch?: boolean
  planMode?: boolean
  onPlanModeChange?: (planMode: boolean) => void
  model?: string
  onModelChange?: (model: string) => void
  onBranchRename?: (branch: string) => void
  onChatRename?: (label: string) => void
}

export function AgentChat({
  chatId,
  roomId,
  sandboxId,
  sandboxName,
  sandboxStatus,
  branch,
  markdownLayerId,
  isFirstChat,
  autoNamedBranch,
  planMode,
  onPlanModeChange,
  model,
  onModelChange,
  onBranchRename,
  onChatRename,
}: AgentChatProps) {
  const { messages, isStreaming, isLoadingHistory, sendMessage, stopMessage } =
    useAgentChat({
      chatId,
      roomId,
      sandboxName,
      branch,
      markdownLayerId,
      isFirstChat,
      autoNamedBranch,
      planMode,
      onBranchRename,
      onChatRename,
    })

  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [serverDefaultModel, setServerDefaultModel] = useState<string | null>(
    null
  )
  // Read the last-used model from localStorage during render (SSR-safe — the
  // reader returns null when `window` is undefined) rather than syncing it in
  // via an effect, which would trigger a cascading render on mount.
  const [storedModel, setStoredModel] = useState<string | null>(readStoredModel)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<ComposerHandle>(null)

  const markdownLayers = useMarkdownLayers()

  // The `/` skill menu is scoped to sandbox-backed Agent chats: Document /
  // Markdown-Layer chats have no sandbox to enumerate, no `read_skill` tool,
  // and their toolset is editorial — so `/` stays a literal slash there.
  const isAgentChat = !markdownLayerId
  const composerPlaceholder = isAgentChat
    ? "Ask the agent... (@ document, / skill)"
    : "Ask the agent... (@ to mention a document)"

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
      })
      .catch(() => {})
      .finally(() => {
        // Mark the fetch settled (success or failure) so the composer can tell a
        // genuinely-empty catalog — the desktop "no agent detected" empty state —
        // apart from one that's still loading.
        if (!cancelled) setModelsLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

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

  // Precedence: per-chat override (set by `onModelChange`) → user's stored
  // last-used model from localStorage → server-side default for the
  // configured provider set → first available. See `resolveDefaultModel`.
  const effectiveModel = resolveDefaultModel({
    perSession: model,
    stored: storedModel,
    serverDefault: serverDefaultModel,
    models,
  })

  const handleModelChange = useCallback(
    (m: string) => {
      writeStoredModel(m)
      setStoredModel(m)
      onModelChange?.(m)
    },
    [onModelChange]
  )

  // The Composer serializes the draft to a Message-Markers wire body and hands
  // it back here with the chosen model; the chat just relays it to the engine.
  const handleSubmit = useCallback(
    ({ text, model }: ComposerSubmitPayload) => {
      sendMessage(text, { model })
    },
    [sendMessage]
  )

  // Element targeting (PRD #616): agent chats in a room can target this branch's
  // own preview frames. The Composer's target icon / ⌘E calls this, which asks
  // the Canvas (through the targeting store) to run a one-shot crosshair pick
  // over the eligible frames and resolves with the picked element — or null when
  // cancelled or when no Canvas is mounted (doc chats, the seed composer). Keyed
  // by the branch id (the sandbox-backed agent's id), which the frame
  // eligibility predicate matches against each frame's `branchId`.
  const handlePickElement = useCallback(() => {
    if (!sandboxId) return Promise.resolve(null)
    return targetingStore.requestPick(sandboxId)
  }, [sandboxId])

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
      sendMessage(text, { model: effectiveModel })
    })
  }, [chatId, sendMessage, effectiveModel])

  // Once a chat has at least one message in its log, the model used for the
  // first turn is locked — switching mid-conversation can confuse the
  // existing tool-call/result message pairs.
  const modelLocked = messages.length > 0

  // While the sandbox is still booting there's no agent to talk to yet — show
  // the same provisioning spinner the terminal does (terminal-tab.tsx) instead
  // of a live composer whose first send would just error. Mirrors the copy and
  // Spinner so a freshly-seeded chat tab and terminal tab read identically.
  if (sandboxStatus === "creating" || sandboxStatus === "starting") {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background px-6 text-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Spinner className="size-4" /> Waiting for the sandbox to start…
        </span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div ref={scrollContentRef} className="flex min-h-full flex-col p-3">
          {isLoadingHistory ? (
            <div className="m-auto">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <p className="m-auto text-center text-xs text-muted-foreground">
              Ask the AI to make changes to your app.
              <br />
              It can read, edit, and run commands in the sandbox.
            </p>
          ) : (
            <div className="space-y-3">
              {messages.map((msg, i) => {
                if (msg.role === "tool_use") {
                  const result = messages
                    .slice(i + 1)
                    .find(
                      (m): m is AgentMessage & { role: "tool_result" } =>
                        m.role === "tool_result" && m.name === msg.name
                    )
                  return (
                    <AgentMessageItem
                      key={i}
                      message={msg}
                      toolResult={result}
                      roomId={roomId}
                      chatId={chatId}
                    />
                  )
                }
                return (
                  <AgentMessageItem
                    key={i}
                    message={msg}
                    roomId={roomId}
                    chatId={chatId}
                  />
                )
              })}
              {isStreaming &&
                messages[messages.length - 1]?.role !== "assistant" && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <GripSpinner className="h-3 w-3" />
                    Thinking...
                  </div>
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
        model={effectiveModel}
        onModelChange={handleModelChange}
        modelLocked={modelLocked}
        planMode={planMode}
        onPlanModeChange={onPlanModeChange}
        onSubmit={handleSubmit}
        isStreaming={isStreaming}
        onStop={stopMessage}
        placeholder={composerPlaceholder}
        onPickElement={isAgentChat && sandboxId ? handlePickElement : undefined}
      />
    </div>
  )
}
