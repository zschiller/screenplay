"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Send,
  Loader2,
  ClipboardList,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAgentChat } from "@/hooks/use-agent-chat"
import { AgentMessageItem } from "./agent-message"
import type { AgentMessage } from "@/lib/agent/types"

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
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isStreaming) return
    sendMessage(input.trim())
    setInput("")
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }, [input, isStreaming, sendMessage])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value)
      e.target.style.height = "auto"
      e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
    },
    [],
  )

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
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask the agent..."
            rows={1}
            className="flex-1 resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Button
            variant={planMode ? "default" : "ghost"}
            size="icon"
            className={`h-7 w-7 shrink-0 ${!planMode ? "text-muted-foreground" : ""}`}
            onClick={() => onPlanModeChange?.(!planMode)}
            title={planMode ? "Plan mode enabled" : "Enable plan mode"}
          >
            <ClipboardList className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={handleSubmit}
            disabled={!input.trim() || isStreaming}
            title="Send"
          >
            {isStreaming ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
