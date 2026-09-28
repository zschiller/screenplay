"use client"

import { useMemo, useRef, useState, type ReactNode } from "react"
import { type Components } from "react-markdown"
import {
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
  Sparkles,
  PencilLine,
  SquarePen,
  Brain,
  Crosshair,
  Bot,
  Square,
  ChevronRight,
} from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Spinner } from "@workspace/ui/components/spinner"
import { GripSpinner } from "@/components/grip-spinner"
import { Button } from "@workspace/ui/components/button"
import type { AgentMessage } from "@/lib/agent/types"
import type { ToolCallContent } from "@/lib/agent/acp/schema"
import type { TurnSummary } from "@/lib/agent/turn-summary"
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { chatStore } from "@/lib/chat-store"
import { inputStore } from "@/lib/input-store"
import { diffLines, foldContext } from "@/lib/agent/line-diff"
import { MENTION_TEXT_CLASS } from "@/lib/mention-styles"
import { useElementHighlight } from "./use-element-highlight"
import { ChatMarkdown } from "./chat-markdown"
import { ChatDisclosure } from "./chat-disclosure"

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

// One shared height cap for every tool-output block, so read, bash, and edit
// all bound their content the same way instead of one growing unbounded while
// another collapses to a tiny scroller. `whitespace-pre-wrap break-words` wraps
// long lines (no horizontal scrollbar); `overflow-y-auto` scrolls only once the
// content exceeds the cap.
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

const DIFF_ROW_CLASS: Record<"context" | "added" | "removed", string> = {
  context: "text-muted-foreground",
  added: "bg-success/10 text-foreground",
  removed: "bg-destructive/10 text-foreground",
}
const DIFF_SIGN: Record<"context" | "added" | "removed", string> = {
  context: " ",
  added: "+",
  removed: "-",
}
const DIFF_SIGN_CLASS: Record<"context" | "added" | "removed", string> = {
  context: "",
  added: "text-success",
  removed: "text-destructive",
}

/** A file edit as a line diff: shared lines as context, changes marked +/-. */
function DiffBlock({ block }: { block: ToolCallContent & { type: "diff" } }) {
  const rows = useMemo(
    () => foldContext(diffLines(block.oldText, block.newText)),
    [block.oldText, block.newText]
  )
  return (
    <div data-testid="tool-content-diff">
      <div className="border-b border-border px-2 py-1 font-mono text-[10px] break-all text-muted-foreground">
        {block.path}
      </div>
      <div className={`${TOOL_OUTPUT_CAP} py-1 font-mono text-[10px]`}>
        {rows.map((row, i) =>
          row.kind === "skip" ? (
            <div key={i} className="px-2 text-muted-foreground/70 select-none">
              ⋯ {row.count} unchanged lines
            </div>
          ) : (
            <div
              key={i}
              data-diff={row.kind}
              className={`flex px-2 ${DIFF_ROW_CLASS[row.kind]}`}
            >
              <span
                aria-hidden
                className={`w-3 shrink-0 select-none ${DIFF_SIGN_CLASS[row.kind]}`}
              >
                {DIFF_SIGN[row.kind]}
              </span>
              <span className="sr-only">
                {row.kind === "added"
                  ? "Added: "
                  : row.kind === "removed"
                    ? "Removed: "
                    : ""}
              </span>
              <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
                {row.text || " "}
              </span>
            </div>
          )
        )}
      </div>
    </div>
  )
}

/**
 * Render one ACP {@link ToolCallContent} block *structurally* — a file `diff`
 * as a line diff, a `terminal` as its handle, a text `content` block as
 * preformatted text — rather than flattening it all to one `<pre>`.
 */
function ToolContentBlock({
  block,
  failed,
}: {
  block: ToolCallContent
  failed?: boolean
}) {
  if (block.type === "diff") return <DiffBlock block={block} />
  if (block.type === "terminal") {
    return (
      <div
        data-testid="tool-content-terminal"
        className="flex items-center gap-1.5 px-2 py-1 font-mono text-[10px] text-muted-foreground"
      >
        <Terminal className="size-3 shrink-0" />
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
      className={`${TOOL_OUTPUT_CAP} px-2 py-1.5 font-mono text-[10px] ${failed ? "text-destructive" : "text-muted-foreground"}`}
    >
      {text}
    </pre>
  )
}

/** The text of a failed call's output, or null when it reported none. */
function hasFailureText(content: ToolCallContent[]): boolean {
  return content.some(
    (b) =>
      b.type !== "content" ||
      (b.content.type === "text" && cleanToolText(b.content.text) !== "")
  )
}

/**
 * A row's title, clipped to one line, with the full text on hover when (and
 * only when) it doesn't fit — long paths and commands are exactly the part a
 * truncated row hides.
 */
function TruncatedTitle({
  children,
  fullText,
}: {
  children: ReactNode
  fullText: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip
        open={open}
        onOpenChange={(next) => {
          const el = ref.current
          setOpen(next && !!el && el.scrollWidth > el.clientWidth)
        }}
      >
        <TooltipTrigger asChild>
          <span ref={ref} className="block truncate">
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="max-w-sm font-mono break-all"
        >
          {fullText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * The one tool-call row (issue #728), keyed by id and advancing through its
 * status lifecycle in place: running shows the progress spinner, done shows the
 * tool's icon, and failed shows the reason — its output, or a line saying none
 * was reported — without needing to be opened. A row only expands when it has
 * output to show.
 */
function ToolCallRow({
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

  const title = structured ? (
    <>
      {label}
      {detail ? (
        <>
          {" "}
          <code className="align-baseline font-mono text-[11px]">{detail}</code>
        </>
      ) : null}
    </>
  ) : (
    renderTitleWithCode(message.title)
  )
  const fullText = structured
    ? [label, detail].filter(Boolean).join(" ")
    : message.title.replace(/`/g, "")

  const icon = running ? (
    <Spinner
      data-testid="tool-call-spinner"
      aria-label="Running"
      className="size-3 shrink-0"
    />
  ) : failed ? (
    <AlertCircle
      aria-label="Failed"
      className="size-3 shrink-0 text-destructive"
    />
  ) : (
    <Icon aria-hidden className="size-3 shrink-0" />
  )
  const headerProps = {
    "data-testid": "tool-call",
    "data-status": message.status,
  }

  if (failed) {
    // A failure is never hidden behind a click: its reason is the body.
    return (
      <ChatDisclosure
        collapsible={false}
        icon={icon}
        title={<TruncatedTitle fullText={fullText}>{title}</TruncatedTitle>}
        headerProps={headerProps}
      >
        {hasFailureText(message.content) ? (
          message.content.map((block, i) => (
            <ToolContentBlock key={i} block={block} failed />
          ))
        ) : (
          <p
            data-testid="tool-call-no-reason"
            className="px-2 py-1.5 text-[11px] text-destructive"
          >
            The tool failed without reporting a reason.
          </p>
        )}
      </ChatDisclosure>
    )
  }

  return (
    <ChatDisclosure
      collapsible={hasContent}
      open={expanded}
      onOpenChange={setExpanded}
      icon={icon}
      title={<TruncatedTitle fullText={fullText}>{title}</TruncatedTitle>}
      headerProps={headerProps}
    >
      {hasContent ? (
        <div className="divide-y divide-border">
          {message.content.map((block, i) => (
            <ToolContentBlock key={i} block={block} />
          ))}
        </div>
      ) : undefined}
    </ChatDisclosure>
  )
}

/**
 * A subagent's tool calls, grouped and collapsible under the `Task` row that
 * spawned them (issue #640). The grouping decision is a pure function
 * ({@link import("@/lib/agent/group-tool-calls").groupToolCalls}); this is the
 * thin render shell over its result.
 *
 * The header carries the subagent's live state — a spinner while any child (or
 * the Task itself) is still running, a red flag if any failed, and a count of the
 * tool calls it has made — so a long-running subagent reads as visible progress
 * rather than an opaque spinner. (There is no meaningful denominator: a subagent's
 * eventual tool-call total is unknown while it runs.) Expanded, it lists the child
 * calls (each a normal
 * {@link ToolCallRow}) advancing through their own status lifecycle.
 *
 * Default open while the subagent works, closed once it has settled: the initial
 * state is seeded from "is anything running" (so a reload of a finished run
 * starts collapsed and a reload mid-run starts open), and a live group
 * auto-collapses when it moves from running to settled (the Task and all its
 * children are no longer pending or in progress). A group that settles as
 * *failed* collapses too — the header's red flag already surfaces the failure,
 * and it keeps a live run consistent with a reload of the same run. Once the
 * user has toggled a group by hand, their choice wins and the auto-collapse
 * leaves it alone. Per-Task expand/collapse *persistence* is out of scope (#636).
 */
export function TaskGroup({
  task,
  childCalls,
}: {
  task: AgentMessage & { role: "tool_call" }
  childCalls: (AgentMessage & { role: "tool_call" })[]
}) {
  const isRunning = (s: AgentMessage & { role: "tool_call" }) =>
    s.status === "pending" || s.status === "in_progress"
  const anyRunning = isRunning(task) || childCalls.some(isRunning)
  const anyFailed =
    task.status === "failed" || childCalls.some((c) => c.status === "failed")
  const [expanded, setExpanded] = useState(anyRunning)
  const [userToggled, setUserToggled] = useState(false)
  // Follow the running ↔ settled transition until the user takes over. Adjusted
  // during render (not in an effect) so a settled group never paints open first.
  const [wasRunning, setWasRunning] = useState(anyRunning)
  if (wasRunning !== anyRunning) {
    setWasRunning(anyRunning)
    if (!userToggled) setExpanded(anyRunning)
  }

  return (
    <div data-testid="task-group">
      <ChatDisclosure
        open={expanded}
        onOpenChange={(next) => {
          setUserToggled(true)
          setExpanded(next)
        }}
        icon={
          anyRunning ? (
            // A running Task is a subagent at work: LLM activity, so the grid.
            <GripSpinner className="size-3 shrink-0" />
          ) : anyFailed ? (
            <AlertCircle
              aria-label="Failed"
              className="size-3 shrink-0 text-destructive"
            />
          ) : (
            <Bot aria-hidden className="size-3 shrink-0" />
          )
        }
        title={renderTitleWithCode(task.title)}
        meta={
          <span className="shrink-0 text-[11px] text-muted-foreground/70 tabular-nums">
            {childCalls.length}
          </span>
        }
        headerProps={{ "data-testid": "task-group-header" }}
      >
        <div className="space-y-2 py-2 pr-2 pl-3">
          {childCalls.map((child) => (
            <ToolCallRow key={child.toolCallId} message={child} />
          ))}
        </div>
      </ChatDisclosure>
    </div>
  )
}

/**
 * A finished turn's steps behind one muted line (issue #800): what the agent
 * read, edited and ran, with a red chip naming each call that failed so a
 * failure shows without opening it. Collapsed by default; opening it shows the
 * steps as they streamed.
 */
export function TurnSummaryRow({
  summary,
  children,
}: {
  summary: TurnSummary
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const { failures } = summary
  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      data-testid="turn-summary"
    >
      <CollapsibleTrigger
        data-testid="turn-summary-trigger"
        className="group/summary flex max-w-full min-w-0 items-start gap-1.5 rounded-md py-0.5 pr-1 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ChevronRight
          aria-hidden
          className="mt-0.5 size-3 shrink-0 transition-transform group-data-[state=open]/summary:rotate-90"
        />
        <span className="min-w-0">
          {summary.text}
          {failures.length > 0 && (
            // Inline, so it follows the text onto a wrapped line.
            <span
              data-testid="turn-summary-failure"
              className="ml-1.5 inline-flex h-[18px] items-center rounded-md bg-destructive/10 px-1.5 align-[1px] text-[11px] font-medium whitespace-nowrap text-destructive"
            >
              {failures.length === 1
                ? `${failures[0]} failed`
                : `${failures.length} failed`}
            </span>
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * The plan quoted as markdown, with an empty line after it for the feedback.
 * Sending a message while a plan waits is how the server takes a rejection, so
 * this is all Request changes needs to do.
 */
export function quotePlan(content: string): string {
  const quoted = content
    .trim()
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")
  return `${quoted}\n\n`
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

  const handleRequestChanges = () => {
    inputStore.append(chatId, quotePlan(message.content))
  }

  const statusBadge = {
    pending: null,
    approved: (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
        <CheckCircle2 className="h-3 w-3" /> Approved
      </span>
    ),
    rejected: (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
        <XCircle className="h-3 w-3" /> Changes requested
      </span>
    ),
  }[message.status]

  const isRejected = message.status === "rejected"
  const [expanded, setExpanded] = useState(!isRejected)

  return (
    <ChatDisclosure
      // Only a rejected plan folds away; a pending or approved one stays open.
      collapsible={isRejected}
      open={expanded}
      onOpenChange={setExpanded}
      icon={<ClipboardList aria-hidden className="size-3 shrink-0" />}
      title={
        <span className="flex items-center gap-2">
          <span className="font-medium">Plan</span>
          {statusBadge}
        </span>
      }
    >
      <div className="px-3 py-2.5">
        {/* The reply's type scale: a plan's headings are body-sized and
            semibold, so its title doesn't outshout the reply around it. */}
        <ChatMarkdown className="prose-headings:text-sm prose-headings:font-semibold">
          {message.content}
        </ChatMarkdown>
        {message.status === "pending" && (
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs"
              onClick={handleApprove}
              disabled={isSubmitting}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={handleRequestChanges}
              disabled={isSubmitting}
            >
              Request changes
            </Button>
          </div>
        )}
        {isRejected && message.feedback && (
          <div className="mt-3 rounded-md border border-border bg-background/60 p-2">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
              <XCircle className="h-3 w-3" /> Your feedback
            </div>
            <ChatMarkdown tone="muted" size="xs">
              {message.feedback}
            </ChatMarkdown>
          </div>
        )}
      </div>
    </ChatDisclosure>
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
    <ChatDisclosure
      open={expanded}
      onOpenChange={setExpanded}
      icon={<Brain aria-hidden className="size-3 shrink-0" />}
      title="Reasoning"
    >
      <ChatMarkdown tone="muted" size="xs" className="px-2 py-1.5">
        {message.content}
      </ChatMarkdown>
    </ChatDisclosure>
  )
}

/**
 * A single element token in the sent-message bubble, hung off a HoverCard that
 * reveals the detail (selector / route / frame) the terse label hides — mirror
 * of the composer's node view. While the card is open it also outlines the
 * referenced element on the canvas via the shared `useElementHighlight`. The
 * canvas highlight needs the frame's layer id, carried in the footer on turns
 * sent after that was added; a legacy token without one still shows the detail
 * card, just no outline.
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
  const handleOpenChange = useElementHighlight(
    refId,
    detail.iframeLayerId,
    detail.selector
  )

  return (
    <HoverCard onOpenChange={handleOpenChange}>
      <HoverCardTrigger asChild>
        <span className={`${MENTION_TEXT_CLASS} font-mono`}>
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
function UserMessage({
  message,
}: {
  message: AgentMessage & { role: "user" }
}) {
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
      new Map(
        parseTargetedElementsFooter(message.content).map((e) => [e.ref, e])
      ),
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
          return <span className={MENTION_TEXT_CLASS}>{children}</span>
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
              <span className={`${MENTION_TEXT_CLASS} font-mono`}>
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
      <ChatMarkdown
        tone="bubble"
        urlTransform={(url) => url}
        components={components}
        className="max-w-[85%] rounded-xl bg-muted px-3 py-1.5"
      >
        {displayContent}
      </ChatMarkdown>
    </div>
  )
}

export function AgentMessageItem({
  message,
  roomId,
  chatId,
}: {
  message: AgentMessage
  roomId?: string
  chatId?: string
}) {
  switch (message.role) {
    case "user":
      return <UserMessage message={message} />

    case "assistant":
      return <ChatMarkdown>{message.content}</ChatMarkdown>

    case "reasoning":
      return <ReasoningMessage message={message} />

    case "tool_call":
      return <ToolCallRow message={message} />

    case "plan":
      return roomId && chatId ? (
        <PlanMessage message={message} roomId={roomId} chatId={chatId} />
      ) : null

    case "error":
      return (
        // Wraps anywhere: a transcript error is often one long URL or stack
        // line with no spaces to break on.
        <div
          data-testid="chat-error"
          className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive"
        >
          <AlertCircle aria-hidden className="mt-px size-3 shrink-0" />
          <p className="min-w-0 flex-1 [overflow-wrap:anywhere] whitespace-pre-wrap">
            {message.content}
          </p>
        </div>
      )

    case "stopped":
      // A rule across the transcript rather than a bubble: it marks where the
      // run was cut short, so the turn above doesn't read as a finished one.
      return (
        <div
          role="note"
          data-testid="run-stopped"
          className="flex items-center gap-2 text-[11px] text-muted-foreground"
        >
          <span className="h-px flex-1 bg-border" />
          <span className="flex items-center gap-1">
            <Square className="size-2 fill-current" />
            Stopped
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )
  }
}
