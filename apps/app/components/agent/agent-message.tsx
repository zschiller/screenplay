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
  GitPullRequest,
  ExternalLink,
  Loader2,
  Sparkles,
  PencilLine,
  SquarePen,
  Brain,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import type { AgentMessage } from "@/lib/agent/types"
import type { ToolCallContent } from "@/lib/agent/acp/schema"
import {
  parseUserMessage,
  skillMarkersToPills,
} from "@/lib/agent/message-markers"
import { chatStore } from "@/lib/chat-store"
import { MENTION_TEXT_CLASS_INVERTED } from "@/lib/mention-styles"

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
  submit_plan: "Submit plan",
  read_document: "Read document",
  replace_document_body: "Rewrite document",
  append_to_document_body: "Append to document",
  set_document_title: "Set title",
}

function formatToolName(name: string): string {
  return (
    toolLabels[name] ??
    name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

// Fallback icons by ACP tool `kind` (read/edit/execute/…), used when the tool
// isn't one of screenplay's own named tools — so a generic ACP agent's calls
// still get a sensible icon rather than the bare default.
const kindIcons: Record<string, typeof FileText> = {
  read: FileText,
  edit: Pencil,
  execute: Terminal,
  fetch: ExternalLink,
  think: Sparkles,
}

/** A short, human-readable detail for a tool call, derived from its raw input. */
function toolDetail(
  title: string,
  rawInput: Record<string, unknown> | undefined
): string | null {
  if (!rawInput) return null
  if (title === "run_command") {
    const cmd = [
      rawInput.command,
      ...((rawInput.args as string[] | undefined) ?? []),
    ]
      .filter(Boolean)
      .join(" ")
    return cmd || null
  }
  if (title === "read_skill") return (rawInput.name as string) ?? null
  if (title === "set_document_title") return (rawInput.title as string) ?? null
  return rawInput.path ? String(rawInput.path) : null
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
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">{title}</div>
          <div className="text-[11px] text-muted-foreground">
            Opening pull request…
          </div>
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
        <div className="min-w-0 flex-1">
          <div className="font-medium">Couldn&apos;t open pull request</div>
          <div className="mt-0.5 text-[11px] break-words opacity-90">
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
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">{title}</div>
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
    <button onClick={() => setExpanded(!expanded)} className="w-full text-left">
      <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="flex-1 truncate">
          {formatToolName(message.name)}
          {isRunCommand && command ? (
            <>
              {" "}
              <code className="align-baseline font-mono text-[11px]">
                {command}
              </code>
            </>
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

/**
 * Render one ACP {@link ToolCallContent} block *structurally* — a file `diff`
 * as path + added/removed text, a `terminal` as its handle, a text `content`
 * block as preformatted text. The point is that ACP's richer output is carried
 * as structure, not flattened to one `<pre>`; the visual polish (a real diff
 * viewer, a terminal emulator) is deferred.
 */
function ToolContentBlock({ block }: { block: ToolCallContent }) {
  if (block.type === "diff") {
    return (
      <div
        data-testid="tool-content-diff"
        className="mt-1 overflow-hidden rounded-md border border-border bg-background"
      >
        <div className="border-b border-border bg-muted/50 px-2 py-1 font-mono text-[10px] text-muted-foreground">
          {block.path}
        </div>
        {block.oldText != null && (
          <pre className="overflow-auto bg-red-50 px-2 py-1 font-mono text-[10px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {block.oldText}
          </pre>
        )}
        <pre className="overflow-auto bg-green-50 px-2 py-1 font-mono text-[10px] text-green-700 dark:bg-green-950/40 dark:text-green-300">
          {block.newText}
        </pre>
      </div>
    )
  }
  if (block.type === "terminal") {
    return (
      <div
        data-testid="tool-content-terminal"
        className="mt-1 flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground"
      >
        <Terminal className="h-3 w-3 shrink-0" />
        terminal {block.terminalId}
      </div>
    )
  }
  // A standard content block — render its text; non-text blocks (image, …) are
  // deferred polish.
  const text = block.content.type === "text" ? block.content.text : ""
  return (
    <pre
      data-testid="tool-content-text"
      className="mt-1 max-h-32 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[10px] text-muted-foreground"
    >
      {text}
    </pre>
  )
}

/**
 * Render an ACP-native tool call (issue #377), keyed by id and advancing
 * through its status lifecycle in place — generalizing the old `create_pr`-only
 * spinner to *every* tool. `pending`/`in_progress` show a spinner; `completed`
 * shows its (optional) structured content; `failed` is flagged red.
 */
function ToolCallIndicator({
  message,
}: {
  message: AgentMessage & { role: "tool_call" }
}) {
  const [expanded, setExpanded] = useState(false)
  const running =
    message.status === "pending" || message.status === "in_progress"
  const failed = message.status === "failed"
  const Icon =
    toolIcons[message.title] ??
    (message.kind ? kindIcons[message.kind] : undefined) ??
    Terminal
  const label = formatToolName(message.title)
  const detail = toolDetail(message.title, message.rawInput)
  const hasContent = message.content.length > 0

  return (
    <button
      onClick={() => hasContent && setExpanded(!expanded)}
      className="w-full text-left"
      data-testid="tool-call"
      data-status={message.status}
    >
      <div
        className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
          failed
            ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
            : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
        }`}
      >
        {running ? (
          <Loader2
            data-testid="tool-call-spinner"
            className="h-3 w-3 shrink-0 animate-spin"
          />
        ) : failed ? (
          <AlertCircle className="h-3 w-3 shrink-0" />
        ) : (
          <Icon className="h-3 w-3 shrink-0" />
        )}
        <span className="flex-1 truncate">
          {label}
          {detail ? (
            <>
              {" "}
              <code className="align-baseline font-mono text-[11px]">
                {detail}
              </code>
            </>
          ) : null}
        </span>
        {hasContent && (
          <ChevronDown
            className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
          />
        )}
      </div>
      {expanded &&
        message.content.map((block, i) => (
          <ToolContentBlock key={i} block={block} />
        ))}
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
          <ChevronDown
            className={`h-3 w-3 text-muted-foreground transition-transform ${expanded ? "" : "-rotate-90"}`}
          />
        )}
      </button>
      {expanded && (
        <>
          <div className="prose prose-sm mt-2 max-w-none text-sm prose-neutral dark:prose-invert prose-headings:my-1.5 prose-p:my-1 prose-code:text-xs prose-code:text-foreground prose-pre:my-1 prose-pre:border prose-pre:border-border prose-pre:bg-background prose-pre:text-foreground prose-ol:my-1 prose-ul:my-1">
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
          {isRejected && message.feedback && (
            <div className="mt-3 rounded-md border border-border bg-background/60 p-2">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                <XCircle className="h-3 w-3" /> Your feedback
              </div>
              <div className="prose prose-sm max-w-none text-xs prose-neutral dark:prose-invert prose-p:my-0.5">
                <Markdown>{message.feedback}</Markdown>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * The agent's reasoning (ACP `agent_thought_chunk`), rendered in a collapsible
 * block kept visually distinct from the assistant message body. Collapsed by
 * default — reasoning is supporting context, not the answer — and minimally
 * styled per ADR 0006 (the point of this slice is that the data survives to the
 * screen, not a polished thinking viewer).
 */
function ReasoningMessage({
  message,
}: {
  message: AgentMessage & { role: "reasoning" }
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-md border border-border bg-muted/30">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/50"
      >
        <Brain className="h-3 w-3 shrink-0" />
        <span className="flex-1 truncate">Reasoning</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
        />
      </button>
      {expanded && (
        <div className="prose prose-sm max-w-none border-t border-border px-2 py-1.5 text-xs text-muted-foreground prose-neutral dark:prose-invert prose-headings:my-1.5 prose-p:my-1 prose-code:text-[11px] prose-pre:my-1 prose-pre:border prose-pre:border-border prose-pre:bg-background prose-ol:my-1 prose-ul:my-1">
          <Markdown>{message.content}</Markdown>
        </div>
      )}
    </div>
  )
}

export function AgentMessageItem({
  message,
  toolResult,
  roomId,
  chatId,
}: {
  message: AgentMessage
  toolResult?: AgentMessage & { role: "tool_result" }
  roomId?: string
  chatId?: string
}) {
  switch (message.role) {
    case "user": {
      // Strip the server turn prefixes and the referenced-documents footer
      // via the Message Markers codec, then recover the `/`-skill chip through
      // the codec's `skillMarkersToPills` — the same `[skill: <name>]` marker
      // the composer's `serializeSkill` emits, rendered back as a pill.
      const displayContent = skillMarkersToPills(
        parseUserMessage(message.content).body
      )
      return (
        <div className="flex justify-end">
          <div className="prose prose-sm max-w-[85%] rounded-lg bg-primary px-3 py-1 text-sm text-primary-foreground [--tw-prose-body:var(--primary-foreground)] [--tw-prose-bold:var(--primary-foreground)] [--tw-prose-bullets:var(--primary-foreground)] [--tw-prose-code:var(--primary-foreground)] [--tw-prose-counters:var(--primary-foreground)] [--tw-prose-headings:var(--primary-foreground)] [--tw-prose-links:var(--primary-foreground)] [--tw-prose-pre-code:var(--primary-foreground)] prose-headings:my-1.5 prose-p:my-1 prose-code:text-xs prose-pre:my-1 prose-pre:border-0 prose-pre:bg-primary-foreground/10 prose-ol:my-1 prose-ul:my-1">
            <Markdown
              urlTransform={(url) => url}
              components={{
                a: ({ href, children, ...props }) => {
                  // `/`-skill and `@`-doc references render as plain inline,
                  // sky-colored text — matching the composer chips. The
                  // serialized children already carry the leading `/` or `@`
                  // marker; no pill, icon, or background.
                  if (
                    typeof href === "string" &&
                    (href.startsWith("skill:") || href.startsWith("mention:"))
                  ) {
                    return (
                      <span className={MENTION_TEXT_CLASS_INVERTED}>
                        {children}
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
        <div className="prose prose-sm max-w-none text-sm prose-neutral dark:prose-invert prose-headings:my-1.5 prose-p:my-1 prose-code:text-xs prose-code:text-foreground prose-pre:my-1 prose-pre:border prose-pre:border-border prose-pre:bg-background prose-pre:text-foreground prose-ol:my-1 prose-ul:my-1">
          <Markdown>{message.content}</Markdown>
        </div>
      )

    case "reasoning":
      return <ReasoningMessage message={message} />

    case "tool_use":
      return <ToolIndicator message={message} result={toolResult} />

    case "tool_result":
      return null

    case "tool_call":
      return <ToolCallIndicator message={message} />

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
