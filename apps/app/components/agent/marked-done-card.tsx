"use client"

import { createContext, useContext, type ReactNode } from "react"
import { CheckIcon } from "@workspace/ui/components/icons"
import { Alert, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { MARKED_DONE_RESULT } from "@/lib/agent/done-result"
import { bareToolName } from "@/lib/agent/tool-name"
import { callIdentity } from "@/lib/agent/tool-description"
import type { AgentMessage } from "@/lib/agent/types"

type ToolCallMessage = AgentMessage & { role: "tool_call" }

/**
 * Whether the chat on show is Done (#1705), and how to reopen it: the Marked
 * done card's Reopen. Absent outside a Workspace chat.
 */
export interface ChatDone {
  done: boolean
  onReopen?: () => void
}

const ChatDoneContext = createContext<ChatDone | null>(null)

export function ChatDoneProvider({
  value,
  children,
}: {
  value: ChatDone
  children: ReactNode
}) {
  return (
    <ChatDoneContext.Provider value={value}>
      {children}
    </ChatDoneContext.Provider>
  )
}

export function isMarkedDoneCall(message: AgentMessage): boolean {
  return (
    message.role === "tool_call" && bareToolName(message.title) === "mark_done"
  )
}

function resultText(message: ToolCallMessage): string {
  return message.content
    .map((b) =>
      b.type === "content" && b.content.type === "text" ? b.content.text : ""
    )
    .join("")
}

/**
 * The card a Workspace chat shows where its agent marked it done with
 * `mark_done` (#1705): Marked done, the agent's reason, and Reopen while
 * the chat is still Done. Renders `fallback` (the plain tool row) while the
 * call runs and when it refused.
 */
export function MarkedDoneCard({
  message,
  fallback,
}: {
  message: ToolCallMessage
  fallback: ReactNode
}) {
  const chat = useContext(ChatDoneContext)
  const marked =
    message.status === "completed" &&
    resultText(message).startsWith(MARKED_DONE_RESULT)
  if (!marked) return <>{fallback}</>
  const reason = callIdentity(message).input.reason
  const onReopen = chat?.done ? chat.onReopen : undefined

  return (
    <Alert
      role="group"
      data-testid="marked-done-card"
      className="flex items-start gap-3"
    >
      <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <AlertTitle>Marked done</AlertTitle>
        {typeof reason === "string" && reason.trim() && (
          <p className="text-sm text-muted-foreground">{reason.trim()}</p>
        )}
      </div>
      {onReopen && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="-my-1 shrink-0"
          onClick={onReopen}
        >
          Reopen
        </Button>
      )}
    </Alert>
  )
}
