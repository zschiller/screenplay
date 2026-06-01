"use client"

import { useState, type ReactNode } from "react"
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
  GitPullRequest,
  ExternalLink,
  Loader2,
  Sparkles,
  PencilLine,
  SquarePen,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import type { AgentMessage } from "@/lib/agent/types"
import { parseUserMessage, skillMarkersToPills } from "@/lib/agent/message-markers"
import { chatStore } from "@/lib/chat-store"

const toolIcons: Record<string, typeof FileText> = {
  read_file: FileText,
  write_file: FileText,
  edit_file: Pencil,
  run_command: Terminal,
  list_files: FolderOpen,
  create_pr: GitPullRequest,
  read_skill: Sparkles,
  read_document: FileText,
  replace_document_body: SquarePen,
  append_to_document_body: SquarePen,
  set_document_title: PencilLine,
}

const toolLabels: Record<string, string> = {
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  run_command: "Run command",
  list_files: "List files",
  create_pr: "Create PR",
  read_skill: "Read skill",
  read_document: "Read document",
  replace_document_body: "Rewrite document",
  append_to_document_body: "Append to document",
  set_document_title: "Set title",
}

function formatToolName(name: string): string {
  return toolLabels[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

function CreatePrIndicator({
  message,
  result,
}: {
  message: AgentMessage & { role: "tool_use" }
  result?: AgentMessage & { role: "tool_result" }
}) {
  const input = message.input as { title?: string; body?: string }
  const title = input.title?.trim() || "Pull request"

  if (!result) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-2 text-xs">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-foreground truncate">{title}</div>
          <div className="text-[11px] text-muted-foreground">Opening pull request…</div>
        </div>
      </div>
    )
  }

  const output = result.output
  const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+/)
  const numberMatch = output.match(/#(\d+)/)
  const failed = /^Failed to create PR/i.test(output)

  if (failed) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">Couldn&apos;t open pull request</div>
          <div className="mt-0.5 text-[11px] opacity-90 break-words">
            {output.replace(/^Failed to create PR:\s*/i, "")}
          </div>
        </div>
      </div>
    )
  }

  if (urlMatch) {
    const url = urlMatch[0]
    const number = numberMatch?.[1]
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-2 text-xs transition-colors hover:border-foreground/20 hover:bg-muted"
      >
        <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-green-700 dark:text-green-300" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-foreground truncate">{title}</div>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            {number && <span>#{number}</span>}
            {number && <span>·</span>}
            <span className="truncate">github.com</span>
          </div>
        </div>
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </a>
    )
  }

  return (
    <div className="rounded-md border border-border bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
      {output}
    </div>
  )
}

function ToolIndicator({
  message,
  result,
}: {
  message: AgentMessage & { role: "tool_use" }
  result?: AgentMessage & { role: "tool_result" }
}) {
  const [expanded, setExpanded] = useState(false)
  if (message.name === "create_pr") {
    return <CreatePrIndicator message={message} result={result} />
  }
  const Icon = toolIcons[message.name] ?? Terminal
  const input = message.input as Record<string, unknown>
  const path = input.path
  const isRunCommand = message.name === "run_command"
  const isReadSkill = message.name === "read_skill"
  const isSetTitle = message.name === "set_document_title"
  const command = isRunCommand
    ? [input.command, ...((input.args as string[] | undefined) ?? [])]
        .filter(Boolean)
        .join(" ")
    : null
  const skillName = isReadSkill ? (input.name as string | undefined) : null
  const newTitle = isSetTitle ? (input.title as string | undefined) : null

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full text-left"
    >
      <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="flex-1 truncate">
          {formatToolName(message.name)}
          {isRunCommand && command ? (
            <> <code className="font-mono text-[11px] align-baseline">{command}</code></>
          ) : isReadSkill && skillName ? (
            ` ${skillName}`
          ) : isSetTitle && newTitle ? (
            ` ${newTitle}`
          ) : path ? (
            ` ${String(path)}`
          ) : null}
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
          <div className="mt-2 text-sm prose prose-sm prose-neutral dark:prose-invert prose-p:my-1 prose-pre:my-1 prose-ul:my-1 prose-ol:my-1 prose-headings:my-1.5 prose-code:text-xs prose-code:text-foreground prose-pre:bg-background prose-pre:text-foreground prose-pre:border prose-pre:border-border max-w-none">
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
      // Strip the server turn prefixes and the referenced-documents footer
      // via the Message Markers codec, then recover the `/`-skill chip through
      // the codec's `skillMarkersToPills` — the same `[skill: <name>]` marker
      // the composer's `serializeSkill` emits, rendered back as a pill.
      const displayContent = skillMarkersToPills(
        parseUserMessage(message.content).body,
      )
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground prose prose-sm prose-p:my-1 prose-pre:my-1 prose-ul:my-1 prose-ol:my-1 prose-headings:my-1.5 prose-code:text-xs prose-pre:bg-primary-foreground/10 prose-pre:border-0 [--tw-prose-body:var(--primary-foreground)] [--tw-prose-headings:var(--primary-foreground)] [--tw-prose-bold:var(--primary-foreground)] [--tw-prose-code:var(--primary-foreground)] [--tw-prose-pre-code:var(--primary-foreground)] [--tw-prose-links:var(--primary-foreground)] [--tw-prose-counters:var(--primary-foreground)] [--tw-prose-bullets:var(--primary-foreground)]">
            <Markdown
              urlTransform={(url) => url}
              components={{
                a: ({ href, children, ...props }) => {
                  if (typeof href === "string" && href.startsWith("skill:")) {
                    return (
                      <span className="inline-flex items-center gap-1 rounded bg-primary-foreground/15 px-1 py-0.5 text-[0.95em] font-medium no-underline">
                        <Sparkles className="size-3.5 shrink-0" />
                        {children}
                      </span>
                    )
                  }
                  if (typeof href === "string" && href.startsWith("mention:")) {
                    // Markdown text was serialized as `@<label>`; strip the
                    // leading `@` so the doc icon stands in for it.
                    const stripAt = (n: ReactNode): ReactNode => {
                      if (typeof n === "string") return n.replace(/^@/, "")
                      if (Array.isArray(n)) {
                        const [first, ...rest] = n
                        return [stripAt(first), ...rest]
                      }
                      return n
                    }
                    return (
                      <span className="inline-flex items-center gap-1 rounded bg-primary-foreground/15 px-1 py-0.5 text-[0.95em] no-underline">
                        <FileText className="size-3.5 shrink-0" />
                        {stripAt(children)}
                      </span>
                    )
                  }
                  return (
                    <a href={href} {...props}>
                      {children}
                    </a>
                  )
                },
              }}
            >
              {displayContent}
            </Markdown>
          </div>
        </div>
      )
    }

    case "assistant":
      return (
        <div className="text-sm prose prose-sm prose-neutral dark:prose-invert prose-p:my-1 prose-pre:my-1 prose-ul:my-1 prose-ol:my-1 prose-headings:my-1.5 prose-code:text-xs prose-code:text-foreground prose-pre:bg-background prose-pre:text-foreground prose-pre:border prose-pre:border-border max-w-none">
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
