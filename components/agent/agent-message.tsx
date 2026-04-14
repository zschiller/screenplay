"use client"

import { useState } from "react"
import Markdown from "react-markdown"
import {
  ChevronDown,
  FileText,
  Terminal,
  Pencil,
  FolderOpen,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ClipboardList,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AgentMessage } from "@/lib/agent/types"
import { chatStore } from "@/lib/chat-store"

const toolIcons: Record<string, typeof FileText> = {
  read_file: FileText,
  write_file: FileText,
  edit_file: Pencil,
  run_command: Terminal,
  list_files: FolderOpen,
}

const toolLabels: Record<string, string> = {
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  run_command: "Run command",
  list_files: "List files",
}

function formatToolName(name: string): string {
  return toolLabels[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

function ToolIndicator({
  message,
  result,
}: {
  message: AgentMessage & { role: "tool_use" }
  result?: AgentMessage & { role: "tool_result" }
}) {
  const [expanded, setExpanded] = useState(false)
  const Icon = toolIcons[message.name] ?? Terminal
  const path = (message.input as Record<string, unknown>).path

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full text-left"
    >
      <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="flex-1 truncate">
          {formatToolName(message.name)}
          {path ? ` ${String(path)}` : null}
        </span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
        />
      </div>
      {expanded && result && (
        <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[10px] text-muted-foreground">
          {result.output}
        </pre>
      )}
    </button>
  )
}

function PlanMessage({
  message,
  roomId,
  chatId,
}: {
  message: AgentMessage & { role: "plan" }
  roomId: string
  chatId: string
}) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleApprove = async () => {
    setIsSubmitting(true)
    await chatStore.approvePlan(roomId, chatId, message.planId)
    setIsSubmitting(false)
  }

  const statusBadge = {
    pending: null,
    approved: (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-950 dark:text-green-400">
        <CheckCircle2 className="h-3 w-3" /> Approved
      </span>
    ),
    rejected: (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
        <XCircle className="h-3 w-3" /> Changes Requested
      </span>
    ),
  }[message.status]

  const isRejected = message.status === "rejected"
  const [expanded, setExpanded] = useState(!isRejected)

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <button
        onClick={() => isRejected && setExpanded(!expanded)}
        className={`flex items-center gap-2 ${isRejected ? "cursor-pointer" : "cursor-default"}`}
      >
        <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Plan</span>
        {statusBadge}
        {isRejected && (
          <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${expanded ? "" : "-rotate-90"}`} />
        )}
      </button>
      {expanded && (
        <>
          <div className="mt-2 text-sm prose prose-sm prose-neutral dark:prose-invert prose-p:my-1 prose-pre:my-1 prose-ul:my-1 prose-ol:my-1 prose-headings:my-1.5 prose-code:text-xs prose-pre:bg-background prose-pre:border prose-pre:border-border max-w-none">
            <Markdown>{message.content}</Markdown>
          </div>
          {message.status === "pending" && (
            <div className="mt-3">
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                onClick={handleApprove}
                disabled={isSubmitting}
              >
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Approve
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function AgentMessageItem({ message, toolResult, roomId, chatId }: { message: AgentMessage; toolResult?: AgentMessage & { role: "tool_result" }; roomId?: string; chatId?: string }) {
  switch (message.role) {
    case "user": {
      const displayContent = message.content.replace(/^\[branch: [^\]]+\] /, "")
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
            {displayContent}
          </div>
        </div>
      )
    }

    case "assistant":
      return (
        <div className="text-sm prose prose-sm prose-neutral dark:prose-invert prose-p:my-1 prose-pre:my-1 prose-ul:my-1 prose-ol:my-1 prose-headings:my-1.5 prose-code:text-xs prose-pre:bg-background prose-pre:border prose-pre:border-border max-w-none">
          <Markdown>{message.content}</Markdown>
        </div>
      )

    case "tool_use":
      return <ToolIndicator message={message} result={toolResult} />

    case "tool_result":
      return null

    case "plan":
      return roomId && chatId ? (
        <PlanMessage message={message} roomId={roomId} chatId={chatId} />
      ) : null

    case "error":
      return (
        <div className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          {message.content}
        </div>
      )
  }
}
