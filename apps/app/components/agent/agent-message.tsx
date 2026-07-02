"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import Markdown, { type Components } from "react-markdown"
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
  Crosshair,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import type { AgentMessage } from "@/lib/agent/types"
import type { ToolCallContent } from "@/lib/agent/acp/schema"
import {
  elementMarkersToPills,
  parseTargetedElementsFooter,
  parseUserMessage,
  skillMarkersToPills,
  type TargetedElement,
} from "@/lib/agent/message-markers"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card"
import { chatStore } from "@/lib/chat-store"
import { targetingStore } from "@/lib/targeting-store"
import { openExternal } from "@/lib/open-external"
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

// A raw snake_case tool identifier (e.g. `read_file`), as reported by
// screenplay's own in-process engine. A generic ACP adapter (e.g.
// claude-agent-acp) instead sends an already human-readable, possibly
// markdown-formatted title like "Read `file.ts`" — which we must leave
// untouched rather than re-casing word by word.
const RAW_TOOL_NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/

function formatToolName(name: string): string {
  const mapped = toolLabels[name]
  if (mapped) return mapped
  // Sentence case, not Title Case: humanize the snake_case identifier and
  // capitalize only the first letter (`read_file` → "Read file").
  const spaced = name.replace(/_/g, " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
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

/**
 * Render an ACP tool-call title as plain text with inline `code` spans only.
 *
 * A generic ACP adapter (claude-agent-acp) hands us an already human-readable
 * title that may wrap a path or command in backticks (`Read `src/a.ts``). We
 * deliberately DON'T run it through a full markdown parser: CommonMark silently
 * mangles other text the title legitimately carries — `src/__init__.py` renders
 * as bold "init" (losing the underscores), `[a](b)` becomes a link that drops
 * its URL, and nested/unbalanced backticks from a shell command leak through as
 * literal backticks. Instead we honor only balanced single-backtick code spans
 * and emit everything else verbatim, so the title can never lose characters.
 */
function renderTitleWithCode(title: string): ReactNode[] {
  const parts: ReactNode[] = []
  const codeSpan = /`([^`]+)`/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = codeSpan.exec(title)) !== null) {
    if (match.index > last) parts.push(title.slice(last, match.index))
    parts.push(
      <code key={key++} className="align-baseline font-mono text-[11px]">
        {match[1]}
      </code>
    )
    last = match.index + match[0].length
  }
  if (last < title.length) parts.push(title.slice(last))
  return parts
}

/** A short, human-readable detail for a tool call, derived from its raw input. */
function toolDetail(title: string, raw: unknown): string | null {
  // `rawInput` is arbitrary JSON (ACP). Only object inputs carry a detail; an
  // array/scalar input has none to show.
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const rawInput = raw as Record<string, unknown>
  if (title === "run_command") return toolCommand(raw)
  if (title === "read_skill") return (rawInput.name as string) ?? null
  if (title === "set_document_title") return (rawInput.title as string) ?? null
  return toolPath(raw)
}

/**
 * The file path a tool call targets, normalized across engines: our in-process
 * tools name it `path`; a generic ACP adapter (claude-agent-acp) may instead use
 * `file_path`/`abs_path`. Returns null when no path-like key is present.
 */
function toolPath(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  for (const key of ["path", "file_path", "filePath", "abs_path", "absPath"]) {
    const v = r[key]
    if (typeof v === "string" && v) return v
  }
  return null
}

/** A `run_command`-style call's full command line (`command` + `args`), or null. */
function toolCommand(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const cmd = [r.command, ...((r.args as string[] | undefined) ?? [])]
    .filter(Boolean)
    .join(" ")
  return cmd || null
}

/**
 * How many file lines a read returned, counted from the gutter-numbered result
 * text — the in-process engine numbers lines `<n>\t…`, claude-agent-acp `<n>→…`.
 * Returns null when there are no numbered lines (still running, an empty file,
 * or a non-file read), so the caller falls back to a plain "Read".
 */
function readLineCount(content: ToolCallContent[]): number | null {
  const text = content
    .map((b) =>
      b.type === "content" && b.content.type === "text" ? b.content.text : ""
    )
    .join("\n")
  const matches = text.match(/^[ \t]*\d+(?:\t|→)/gm)
  return matches ? matches.length : null
}

/**
 * The verb a structured tool call leads with, keyed by ACP `kind` so a generic
 * adapter's prose title ("Read File") renders with the same word our own tools
 * do. Only the kinds we can also reconstruct a detail for are listed; an unlisted
 * kind (fetch/think/other) keeps the adapter's prose title verbatim instead.
 */
const KIND_VERB: Record<string, string> = {
  read: "Read",
  edit: "Edit",
  execute: "Run command",
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
        onClick={(e) => {
          // The desktop webview can't honor target="_blank"; route through the
          // opener plugin (and keep `href` for context-menu copy/accessibility).
          e.preventDefault()
          openExternal(url)
        }}
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
    // Keep the scrollable output OUTSIDE the <button> — see ToolCallIndicator:
    // a max-height-clamped overflow child nested in a button mislays out under
    // WebKit (the desktop app's WKWebView).
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
      >
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
      </button>
      {expanded && result && (
        <pre
          className={`mt-1 ${TOOL_OUTPUT_CAP} rounded-md border border-border bg-background p-2 font-mono text-[10px] text-muted-foreground`}
        >
          {result.output}
        </pre>
      )}
    </div>
  )
}

// One shared height cap for every expanded tool-output block, so read, bash,
// and edit all bound their content the same way instead of one growing
// unbounded while another collapses to a tiny scroller. `whitespace-pre-wrap
// break-words` wraps long lines (no horizontal scrollbar); `overflow-y-auto`
// scrolls only once the content exceeds the cap.
const TOOL_OUTPUT_CAP =
  "max-h-64 overflow-y-auto whitespace-pre-wrap break-words"

/**
 * Strip the wrapper noise Claude Code bakes into file-read results that a
 * generic ACP adapter (claude-agent-acp) forwards verbatim, so the compact
 * tool-output preview shows just the file's text:
 *  - `<system-reminder>…</system-reminder>` guidance blocks,
 *  - a single enclosing ``` fence the read is wrapped in,
 *  - the `   12→` line-number gutter of its `cat -n`-style read format.
 * Display-only — the untouched file content still lives in the editor.
 */
function cleanToolText(text: string): string {
  let out = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .trim()
  const fenced = out.match(/^```[^\n]*\n([\s\S]*?)\n?```$/)
  if (fenced) out = fenced[1]
  // Drop the leading line-number gutter (`<spaces>123→`) prefixed onto each
  // read line. The `→` (U+2192) makes this distinctive enough to not maul
  // ordinary output.
  return out.replace(/^[ \t]*\d+→/gm, "")
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
        className={`mt-1 ${TOOL_OUTPUT_CAP} rounded-md border border-border bg-background`}
      >
        <div className="border-b border-border bg-muted/50 px-2 py-1 font-mono text-[10px] text-muted-foreground">
          {block.path}
        </div>
        {block.oldText != null && (
          <pre className="bg-red-50 px-2 py-1 font-mono text-[10px] break-words whitespace-pre-wrap text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {block.oldText}
          </pre>
        )}
        <pre className="bg-green-50 px-2 py-1 font-mono text-[10px] break-words whitespace-pre-wrap text-green-700 dark:bg-green-950/40 dark:text-green-300">
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
  const text =
    block.content.type === "text" ? cleanToolText(block.content.text) : ""
  return (
    <pre
      data-testid="tool-content-text"
      className={`mt-1 ${TOOL_OUTPUT_CAP} rounded-md border border-border bg-background p-2 font-mono text-[10px] text-muted-foreground`}
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
  // Render every engine's tool call the same way: derive the verb + detail from
  // the tool identity (`kind` / raw name) and `rawInput`, not from whatever prose
  // title an adapter happens to send — so an in-process `read_file` and a
  // claude-agent-acp "Read File" both show "Read N lines `path`". Our own tools
  // report a raw snake_case name (humanized + given a derived detail); a generic
  // adapter's prose title is normalized via its ACP `kind`. A call we can't
  // structure (an unknown kind with no recognizable input) keeps the adapter's
  // prose title verbatim, rendered with inline `code` only.
  const isRawToolName = RAW_TOOL_NAME.test(message.title)
  const path = toolPath(message.rawInput)
  const detail = isRawToolName
    ? toolDetail(message.title, message.rawInput)
    : message.kind === "execute"
      ? toolCommand(message.rawInput)
      : path
  const verb = isRawToolName
    ? formatToolName(message.title)
    : message.kind
      ? (KIND_VERB[message.kind] ?? null)
      : null
  // A read leads with the line count it returned ("Read 42 lines"); other tools
  // just show their verb. Gated on a path so a `read_skill`/`list_files` (also
  // `kind: "read"`) never sprouts a spurious line count.
  const lineCount =
    message.kind === "read" && path ? readLineCount(message.content) : null
  const label =
    lineCount != null
      ? `${verb} ${lineCount} ${lineCount === 1 ? "line" : "lines"}`
      : verb
  // Structure it when we have a real verb (our own raw tool, or a known kind we
  // could attach a detail to); otherwise fall back to the adapter's prose title.
  const structured = isRawToolName || (verb != null && detail != null)
  const hasContent = message.content.length > 0

  return (
    // The expanded content must live OUTSIDE the <button>: WebKit (WKWebView,
    // where the desktop app runs) reserves a scrollable, max-height-clamped
    // child's *full* content height for layout when it's nested inside a
    // <button>, so the row would occupy the un-scrolled height yet still scroll
    // — leaving a large gap. Keeping the button to just the header sidesteps it.
    <div>
      <button
        onClick={() => hasContent && setExpanded(!expanded)}
        data-testid="tool-call"
        data-status={message.status}
        className={`flex w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs ${
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
          {structured ? (
            <>
              {label}
              {detail ? (
                <>
                  {" "}
                  <code className="align-baseline font-mono text-[11px]">
                    {detail}
                  </code>
                </>
              ) : null}
            </>
          ) : (
            renderTitleWithCode(message.title)
          )}
        </span>
        {hasContent && (
          <ChevronDown
            className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
          />
        )}
      </button>
      {expanded &&
        message.content.map((block, i) => (
          <ToolContentBlock key={i} block={block} />
        ))}
    </div>
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

/**
 * A single element token in the sent-message bubble, hung off a HoverCard that
 * reveals the detail (selector / route / frame) the terse label hides — mirror
 * of the composer's node view. While the card is open it also outlines the
 * referenced element on the canvas via the targeting store, guarded by `refId`
 * so leaving clears only our own highlight (and an unmount clears it too, in
 * case the card closes by teardown rather than a pointer-out). The canvas
 * highlight needs the frame's layer id, carried in the footer on turns sent
 * after that was added; a legacy token without one still shows the detail card,
 * just no outline.
 *
 * Module-scoped (not an inline closure inside the markdown `components`) so its
 * identity is stable: the highlight re-renders the Canvas subtree that hosts the
 * chat, and a fresh component type each render would remount this token — which
 * resets the HoverCard mid-hover and flickers it open/closed in a loop.
 */
function ElementHistoryToken({
  refId,
  detail,
  children,
}: {
  refId: string
  detail: TargetedElement
  children: ReactNode
}) {
  useEffect(() => {
    return () => targetingStore.clearHighlight(refId)
  }, [refId])

  const handleOpenChange = (open: boolean) => {
    if (open && detail.iframeLayerId && detail.selector) {
      targetingStore.setHighlight({
        iframeLayerId: detail.iframeLayerId,
        selector: detail.selector,
        ref: refId,
      })
    } else {
      targetingStore.clearHighlight(refId)
    }
  }

  return (
    <HoverCard onOpenChange={handleOpenChange}>
      <HoverCardTrigger asChild>
        <span className={`${MENTION_TEXT_CLASS_INVERTED} font-mono`}>
          <Crosshair className="mr-0.5 inline size-[1em] align-[-0.15em]" />
          {children}
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="gap-2">
        <div className="font-mono text-xs break-all text-foreground">
          {detail.selector || "(no selector)"}
        </div>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <div className="flex gap-1.5">
            <span className="shrink-0 text-foreground/60">Route</span>
            <span className="font-mono break-all">{detail.route}</span>
          </div>
          {detail.frameLabel ? (
            <div className="flex gap-1.5">
              <span className="shrink-0 text-foreground/60">Frame</span>
              <span className="break-all">{detail.frameLabel}</span>
            </div>
          ) : null}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

/**
 * The sent user-message bubble. Split into its own component so it can memoize
 * the markdown `components` map and the parsed footer detail against
 * `message.content`: the element-token highlight re-renders the Canvas subtree
 * this lives in, and a fresh `components` object each render would remount every
 * token (see `ElementHistoryToken`). Memoizing keeps the token instances stable
 * so an open HoverCard survives those re-renders.
 */
function UserMessage({ message }: { message: AgentMessage & { role: "user" } }) {
  // Strip the server turn prefixes and the referenced-documents / targeted-
  // elements footers via the Message Markers codec, then recover the inline
  // chips: `skillMarkersToPills` for the `/`-skill marker and
  // `elementMarkersToPills` for each `[element: …]` element token — the same
  // markers the composer's `serializeSkill` / `serializeElement` emit, rendered
  // back as inline references below.
  const displayContent = useMemo(
    () =>
      elementMarkersToPills(
        skillMarkersToPills(parseUserMessage(message.content).body)
      ),
    [message.content]
  )
  // The terse inline label hides the messy detail; recover it from the
  // `Targeted elements:` footer, keyed by the same `ref` the inline `element:`
  // link carries, so each history token can hang a hover card off it.
  const targetedElements = useMemo(
    () =>
      new Map(parseTargetedElementsFooter(message.content).map((e) => [e.ref, e])),
    [message.content]
  )
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children, ...props }) => {
        // `/`-skill and `@`-doc references render as plain inline, sky-colored
        // text — matching the composer chips. The serialized children already
        // carry the leading `/` or `@` marker; no pill, icon, or background.
        if (
          typeof href === "string" &&
          (href.startsWith("skill:") || href.startsWith("mention:"))
        ) {
          return <span className={MENTION_TEXT_CLASS_INVERTED}>{children}</span>
        }
        // element tokens: a clean lucide crosshair + `font-mono` tag name,
        // matching the composer token. Detail rides the footer, keyed by the
        // link's `element:<ref>`; missing (a footer-less legacy turn) → plain
        // token, no card.
        if (typeof href === "string" && href.startsWith("element:")) {
          const refId = href.slice("element:".length)
          const detail = targetedElements.get(refId)
          if (!detail) {
            return (
              <span className={`${MENTION_TEXT_CLASS_INVERTED} font-mono`}>
                <Crosshair className="mr-0.5 inline size-[1em] align-[-0.15em]" />
                {children}
              </span>
            )
          }
          return (
            <ElementHistoryToken refId={refId} detail={detail}>
              {children}
            </ElementHistoryToken>
          )
        }
        return (
          <a href={href} {...props}>
            {children}
          </a>
        )
      },
    }),
    [targetedElements]
  )

  return (
    <div className="flex justify-end">
      <div className="prose prose-sm max-w-[85%] rounded-lg bg-primary px-3 py-1 text-sm text-primary-foreground [--tw-prose-body:var(--primary-foreground)] [--tw-prose-bold:var(--primary-foreground)] [--tw-prose-bullets:var(--primary-foreground)] [--tw-prose-code:var(--primary-foreground)] [--tw-prose-counters:var(--primary-foreground)] [--tw-prose-headings:var(--primary-foreground)] [--tw-prose-links:var(--primary-foreground)] [--tw-prose-pre-code:var(--primary-foreground)] prose-headings:my-1.5 prose-p:my-1 prose-code:text-xs prose-pre:my-1 prose-pre:border-0 prose-pre:bg-primary-foreground/10 prose-ol:my-1 prose-ul:my-1">
        <Markdown urlTransform={(url) => url} components={components}>
          {displayContent}
        </Markdown>
      </div>
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
    case "user":
      return <UserMessage message={message} />

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
        <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {message.content}
        </div>
      )
  }
}
