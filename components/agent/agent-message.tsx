"use client"

import { useState } from "react"
import {
  ChevronDown,
  FileText,
  Terminal,
  Pencil,
  FolderOpen,
  AlertCircle,
} from "lucide-react"
import type { AgentMessage } from "@/lib/agent/types"

const toolIcons: Record<string, typeof FileText> = {
  read_file: FileText,
  write_file: FileText,
  edit_file: Pencil,
  run_command: Terminal,
  list_files: FolderOpen,
}

function ToolIndicator({
  message,
}: {
  message: AgentMessage & { role: "tool_use" | "tool_result" }
}) {
  const [expanded, setExpanded] = useState(false)
  const Icon = toolIcons[message.name] ?? Terminal
  const isResult = message.role === "tool_result"

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full text-left"
    >
      <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-muted">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="flex-1 truncate font-mono">
          {message.name}
          {!isResult && "input" in message
            ? (() => {
                const path = (message.input as Record<string, unknown>).path
                return path ? ` ${String(path)}` : null
              })()
            : null}
        </span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
        />
      </div>
      {expanded && (
        <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[10px] text-muted-foreground">
          {isResult
            ? (message as AgentMessage & { role: "tool_result" }).output
            : JSON.stringify(
                (message as AgentMessage & { role: "tool_use" }).input,
                null,
                2,
              )}
        </pre>
      )}
    </button>
  )
}

export function AgentMessageItem({ message }: { message: AgentMessage }) {
  switch (message.role) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground">
            {message.content}
          </div>
        </div>
      )

    case "assistant":
      return (
        <div className="flex justify-start">
          <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-xs">
            {message.content}
          </div>
        </div>
      )

    case "tool_use":
    case "tool_result":
      return <ToolIndicator message={message} />

    case "error":
      return (
        <div className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          {message.content}
        </div>
      )
  }
}
