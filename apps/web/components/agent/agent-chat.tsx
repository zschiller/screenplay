"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowUp,
  Loader2,
  ClipboardList,
  ChevronDown,
  Check,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { useAgentChat } from "@/hooks/use-agent-chat"
import { AgentMessageItem } from "./agent-message"
import type { AgentMessage } from "@/lib/agent/types"
import { inputStore } from "@/lib/input-store"
import { getModels, type ModelInfo } from "@/lib/models-store"

const DEFAULT_MODEL_ID = "claude-sonnet-4-6"

const MODEL_FAMILIES: Array<{ id: string; label: string }> = [
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
]

function groupModelsByFamily(models: ModelInfo[]) {
  const groups = MODEL_FAMILIES.map((f) => ({
    ...f,
    models: models.filter((m) => m.id.toLowerCase().includes(f.id)),
  }))
  const assigned = new Set(groups.flatMap((g) => g.models.map((m) => m.id)))
  const other = models.filter((m) => !assigned.has(m.id))
  return other.length > 0
    ? [...groups, { id: "other", label: "Other", models: other }]
    : groups
}

interface AgentChatProps {
  chatId: string
  roomId: string
  sandboxId: string
  sandboxName: string
  branch: string
  sessionId?: string
  isFirstChat?: boolean
  planMode?: boolean
  onPlanModeChange?: (planMode: boolean) => void
  model?: string
  onModelChange?: (model: string) => void
  onSessionId?: (sessionId: string) => void
  onBranchRename?: (branch: string) => void
  onChatRename?: (label: string) => void
}

export function AgentChat({
  chatId,
  roomId,
  sandboxId,
  sandboxName,
  branch,
  sessionId,
  isFirstChat,
  planMode,
  onPlanModeChange,
  model,
  onModelChange,
  onSessionId,
  onBranchRename,
  onChatRename,
}: AgentChatProps) {
  const {
    messages,
    isStreaming,
    isLoadingHistory,
    sendMessage,
  } = useAgentChat({ chatId, roomId, sandboxName, branch, sessionId, isFirstChat, planMode, onSessionId, onBranchRename, onChatRename })

  const [input, setInput] = useState("")
  const [models, setModels] = useState<ModelInfo[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    let cancelled = false
    getModels().then((list) => {
      if (!cancelled) setModels(list)
    }).catch(() => {})
    return () => { cancelled = true }
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

  const effectiveModel = model ?? DEFAULT_MODEL_ID

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isStreaming) return
    sendMessage(input.trim(), { model: effectiveModel })
    setInput("")
  }, [input, isStreaming, sendMessage, effectiveModel])

  const modelLocked = Boolean(sessionId)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  const currentModel =
    models.find((m) => m.id === effectiveModel) ??
    { id: effectiveModel, label: effectiveModel }

  const modelGroups = useMemo(() => groupModelsByFamily(models), [models])

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
                  modelGroups
                    .filter((g) => g.models.length > 0)
                    .map((group, idx) => (
                      <div key={group.id}>
                        {idx > 0 && <DropdownMenuSeparator />}
                        {group.models.map((m) => (
                          <DropdownMenuItem
                            key={m.id}
                            onSelect={() => onModelChange?.(m.id)}
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
            <InputGroupButton
              size="icon-xs"
              variant={input.trim() && !isStreaming ? "default" : "ghost"}
              onClick={handleSubmit}
              disabled={!input.trim() || isStreaming}
              title="Send"
              className="ml-auto"
            >
              {isStreaming ? (
                <Loader2 className="animate-spin" />
              ) : (
                <ArrowUp />
              )}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  )
}
