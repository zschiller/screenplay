"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowUp,
  Loader2,
  ClipboardList,
  ChevronDown,
  Check,
  Square,
} from "lucide-react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@workspace/ui/components/input-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { useAgentChat } from "@/hooks/use-agent-chat"
import { AgentMessageItem } from "./agent-message"
import type { AgentMessage } from "@/lib/agent/types"
import { inputStore } from "@/lib/input-store"
import { getDefaultModelId, getModels, type ModelInfo } from "@/lib/models-store"

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

/**
 * Group models by their origin provider (Anthropic, OpenAI, Vercel AI
 * Gateway, …) so the dropdown surfaces them under headings the user can
 * scan. Preserves the registry's order both at the group level (which
 * provider showed up first in `enumerateModels`) and within each group.
 */
function groupModelsByProvider(models: ModelInfo[]) {
  const order: string[] = []
  const byKey = new Map<
    string,
    { key: string; label: string; models: ModelInfo[] }
  >()
  for (const m of models) {
    let group = byKey.get(m.provider.key)
    if (!group) {
      group = { key: m.provider.key, label: m.provider.label, models: [] }
      byKey.set(m.provider.key, group)
      order.push(m.provider.key)
    }
    group.models.push(m)
  }
  return order.map((k) => byKey.get(k)!)
}

interface AgentChatProps {
  chatId: string
  roomId: string
  sandboxId: string
  sandboxName: string
  branch: string
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
  branch,
  isFirstChat,
  autoNamedBranch,
  planMode,
  onPlanModeChange,
  model,
  onModelChange,
  onBranchRename,
  onChatRename,
}: AgentChatProps) {
  const {
    messages,
    isStreaming,
    isLoadingHistory,
    sendMessage,
    stopMessage,
  } = useAgentChat({ chatId, roomId, sandboxName, branch, isFirstChat, autoNamedBranch, planMode, onBranchRename, onChatRename })

  const [input, setInput] = useState("")
  const [models, setModels] = useState<ModelInfo[]>([])
  const [serverDefaultModel, setServerDefaultModel] = useState<string | null>(null)
  const [storedModel, setStoredModel] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setStoredModel(readStoredModel())
  }, [])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    let cancelled = false
    Promise.all([getModels(), getDefaultModelId()])
      .then(([list, def]) => {
        if (cancelled) return
        setModels(list)
        setServerDefaultModel(def)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Allow other parts of the app (e.g. the inspect tool) to append text to this chat's draft.
  useEffect(() => {
    return inputStore.subscribe(chatId, (text) => {
      setInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${text}` : text))
      requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (!ta) return
        ta.focus()
        const end = ta.value.length
        ta.setSelectionRange(end, end)
      })
    })
  }, [chatId])

  // Precedence: per-chat override (set by `onModelChange`) → user's stored
  // last-used model from localStorage → server-side default for the
  // configured provider set. The string is "" while the catalog is still
  // loading so the dropdown can render a "Loading…" placeholder rather than
  // a stale id from a different deployment's provider.
  const effectiveModel = model ?? storedModel ?? serverDefaultModel ?? ""

  const handleModelChange = useCallback(
    (m: string) => {
      writeStoredModel(m)
      setStoredModel(m)
      onModelChange?.(m)
    },
    [onModelChange],
  )

  // Allow shortcut actions (e.g. the Create PR button) to send a message directly.
  useEffect(() => {
    return inputStore.subscribeSend(chatId, (text) => {
      sendMessage(text, { model: effectiveModel })
    })
  }, [chatId, sendMessage, effectiveModel])

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isStreaming) return
    sendMessage(input.trim(), { model: effectiveModel })
    setInput("")
  }, [input, isStreaming, sendMessage, effectiveModel])

  // Once a chat has at least one message in its log, the model used for the
  // first turn is locked — switching mid-conversation can confuse the
  // existing tool-call/result message pairs.
  const modelLocked = messages.length > 0

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  const currentModel = models.find((m) => m.id === effectiveModel) ?? {
    id: effectiveModel,
    label: effectiveModel || "Loading…",
  }

  const modelGroups = useMemo(() => groupModelsByProvider(models), [models])

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3">
        {isLoadingHistory ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-center text-xs text-muted-foreground">
              Ask the AI to make changes to your app.
              <br />
              It can read, edit, and run commands in the sandbox.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, i) => {
              if (msg.role === "tool_use") {
                const result = messages.slice(i + 1).find(
                  (m): m is AgentMessage & { role: "tool_result" } =>
                    m.role === "tool_result" && m.name === msg.name
                )
                return <AgentMessageItem key={i} message={msg} toolResult={result} roomId={roomId} chatId={chatId} />
              }
              return <AgentMessageItem key={i} message={msg} roomId={roomId} chatId={chatId} />
            })}
            {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Thinking...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border p-3">
        <InputGroup className="has-disabled:bg-transparent has-disabled:opacity-100 dark:has-disabled:bg-input/30">
          <InputGroupTextarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the agent..."
            rows={2}
            className="max-h-48 text-xs"
          />
          <InputGroupAddon align="block-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <InputGroupButton
                  size="xs"
                  className="text-xs"
                  disabled={modelLocked}
                  title={modelLocked ? "Model is locked to this session" : "Change model"}
                >
                  {currentModel.label}
                  <ChevronDown />
                </InputGroupButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {models.length === 0 ? (
                  <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
                ) : (
                  modelGroups.map((group, idx) => (
                    <div key={group.key}>
                      {idx > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {group.label}
                      </DropdownMenuLabel>
                      {group.models.map((m) => (
                        <DropdownMenuItem
                          key={m.id}
                          onSelect={() => handleModelChange(m.id)}
                        >
                          <span className="flex-1">{m.label}</span>
                          {m.id === effectiveModel && <Check className="size-3.5" />}
                        </DropdownMenuItem>
                      ))}
                    </div>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <InputGroupButton
              size="xs"
              variant={planMode ? "default" : "ghost"}
              onClick={() => onPlanModeChange?.(!planMode)}
              title={planMode ? "Plan mode enabled" : "Enable plan mode"}
              className="text-xs"
            >
              <ClipboardList />
              Plan
            </InputGroupButton>
            {isStreaming ? (
              <InputGroupButton
                size="icon-xs"
                variant="secondary"
                onClick={stopMessage}
                title="Stop"
                className="ml-auto"
              >
                <Square fill="currentColor" />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                size="icon-xs"
                variant={input.trim() ? "default" : "ghost"}
                onClick={handleSubmit}
                disabled={!input.trim()}
                title="Send"
                className="ml-auto"
              >
                <ArrowUp />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  )
}
