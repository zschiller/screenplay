"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Send,
  Square,
  Loader2,
  RotateCcw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAgentChat } from "@/hooks/use-agent-chat"
import { AgentMessageItem } from "./agent-message"

interface AgentChatProps {
  sandboxName: string
  branch: string
  sessionId?: string
  onSessionId?: (sessionId: string) => void
  onBranchRename?: (branch: string) => void
}

export function AgentChat({
  sandboxName,
  branch,
  sessionId,
  onSessionId,
  onBranchRename,
}: AgentChatProps) {
  const {
    messages,
    isStreaming,
    isLoadingHistory,
    sendMessage,
    stopGeneration,
    resetConversation,
  } = useAgentChat({ sandboxName, sessionId, onSessionId, onBranchRename })

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
    // Reset textarea height
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

  // Auto-resize textarea
  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value)
      e.target.style.height = "auto"
      e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
    },
    [],
  )

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <span className="text-xs font-medium">AI Assistant</span>
          <span className="ml-2 truncate font-mono text-[10px] text-muted-foreground">
            {branch}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={resetConversation}
            title="New conversation"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
      </div>

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
          <div className="space-y-2">
            {messages.map((msg, i) => (
              <AgentMessageItem key={i} message={msg} />
            ))}
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
          {isStreaming ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={stopGeneration}
              title="Stop"
            >
              <Square className="h-3 w-3" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={handleSubmit}
              disabled={!input.trim()}
              title="Send"
            >
              <Send className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
