"use client"

import { useMemo, useRef, useState, type ReactNode } from "react"
import { defaultUrlTransform, type Components } from "react-markdown"
import {
  AppWindowIcon,
  ArrowSquareOutIcon,
  ArrowsDownUpIcon,
  ArrowUUpLeftIcon,
  ArrowsClockwiseIcon,
  ArrowsMergeIcon,
  ArrowsOutCardinalIcon,
  BookBookmarkIcon,
  BookOpenIcon,
  CaretUpDownIcon,
  CursorIcon,
  LightbulbIcon,
  ChatTextIcon,
  ChatCircleIcon,
  GlobeIcon,
  NotepadIcon,
  ScribbleIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  ClockCounterClockwiseIcon,
  CodeIcon,
  CopyIcon,
  CrosshairIcon,
  EyeIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderOpenIcon,
  GitDiffIcon,
  GitPullRequestIcon,
  LayoutIcon,
  ListBulletsIcon,
  ListDashesIcon,
  MagnifyingGlassIcon,
  NotePencilIcon,
  PencilSimpleIcon,
  PencilSimpleLineIcon,
  PlayIcon,
  QuestionIcon,
  RobotIcon,
  SelectionIcon,
  SquareIcon,
  SquaresFourIcon,
  StopCircleIcon,
  TerminalIcon,
  TrashIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@workspace/ui/components/icons"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import { toast } from "sonner"
import { GripSpinner } from "@/components/grip-spinner"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import type { AgentMessage } from "@/lib/agent/types"
import type { ToolCallContent } from "@/lib/agent/acp/schema"
import type { TurnSummary } from "@/lib/agent/turn-summary"
import {
  describeToolCall,
  driveName,
  echoesInput,
  readableFrameNames,
  type RowLabel,
  type ToolDescription,
  type ToolIcon,
} from "@/lib/agent/tool-description"
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd"
import {
  elementMarkersToPills,
  mockupMarkersToRefs,
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
import { InlineRef } from "@/components/agent/inline-ref"
import { WorkspaceStateGlyph } from "@/components/workspace-mention"
import {
  roomWorkspaceFacts,
  workspaceState,
} from "@/lib/branch/workspace-state"
import { parseLayerLink } from "@/lib/agent/layer-link"
import { useMockupTitle } from "@/lib/yjs/react"
import { attachmentUrl } from "@/lib/chat-attachments"
import { SentAttachmentChip } from "@/components/agent/attachment-chip"
import { ElementDetail } from "./element-detail"
import { commandOutput, highlight, languageFor, LogText } from "./tool-output"
import { ChatMarkdown } from "./chat-markdown"
import { ANSI_PALETTE_CSS } from "@workspace/ui/lib/ansi-palette"
import { useElementHighlight } from "./use-element-highlight"
import { ChatDisclosure } from "./chat-disclosure"
import { useWorkspaceTasks, WorkspaceTaskRow } from "./workspace-task-row"
import { QuestionCard } from "./question-card"
import { isSaveSkillCall, SkillSaveCard } from "./skill-save-card"
import { Avatar, AvatarImage } from "@workspace/ui/components/avatar"
import type { ChatSender } from "@/hooks/use-chat-senders"
import {
  isQuestionCall,
  parseQuestion,
  type QuestionAnswer,
} from "@/lib/agent/question"
import {
  WORKSPACE_LINK_SCHEME,
  workspaceTasksOf,
} from "@/lib/agent/workspace-task"

// The glyph for each icon a tool's description names (tool-description.ts).
const TOOL_ICONS: Record<ToolIcon, typeof FileTextIcon> = {
  file: FileTextIcon,
  "file-plus": FilePlusIcon,
  edit: PencilSimpleIcon,
  rename: PencilSimpleLineIcon,
  note: NotePencilIcon,
  terminal: TerminalIcon,
  folder: FolderOpenIcon,
  search: MagnifyingGlassIcon,
  "pull-request": GitPullRequestIcon,
  skill: BookOpenIcon,
  logs: ListDashesIcon,
  restart: ArrowsClockwiseIcon,
  stop: SquareIcon,
  play: PlayIcon,
  canvas: SquaresFourIcon,
  chat: ChatCircleIcon,
  "chat-text": ChatTextIcon,
  diff: GitDiffIcon,
  eye: EyeIcon,
  code: CodeIcon,
  cursor: CursorIcon,
  window: AppWindowIcon,
  list: ListBulletsIcon,
  scroll: ArrowsDownUpIcon,
  select: CaretUpDownIcon,
  memory: NotepadIcon,
  move: ArrowsOutCardinalIcon,
  layout: LayoutIcon,
  selection: SelectionIcon,
  merge: ArrowsMergeIcon,
  trash: TrashIcon,
  history: ClockCounterClockwiseIcon,
  undo: ArrowUUpLeftIcon,
  crosshair: CrosshairIcon,
  workspaces: BookBookmarkIcon,
  "stop-circle": StopCircleIcon,
  question: QuestionIcon,
  mockup: ScribbleIcon,
  send: ChatTextIcon,
  globe: GlobeIcon,
  robot: RobotIcon,
  warning: WarningCircleIcon,
  fetch: ArrowSquareOutIcon,
  think: LightbulbIcon,
}

/**
 * Render an ACP tool-call title as plain text, with its inline `code` spans
 * marked as the row's subject (in the UI font like the rest of the row).
 *
 * A generic ACP adapter (claude-agent-acp) hands us an already human-readable
 * title that may wrap a path or command in backticks (`Read `src/a.ts``). We
 * deliberately DON'T run it through a full markdown parser: CommonMark silently
 * mangles other text the title legitimately carries — `src/__init__.py` renders
 * as bold "init" (losing the underscores), `[a](b)` becomes a link that drops
 * its URL, and nested/unbalanced backticks from a shell command leak through as
 * literal backticks. Instead we honor only balanced single-backtick spans
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
      <span key={key++} data-row-detail>
        {match[1]}
      </span>
    )
    last = match.index + match[0].length
  }
  if (last < title.length) parts.push(title.slice(last))
  return parts
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
  out = out.replace(/^[ \t]*\d+→/gm, "")
  // PROTOTYPE: the in-process engine's `<n>\t` gutter, only when every line has one.
  const lines = out.split("\n")
  if (lines.length > 0 && lines.every((l) => /^[ \t]*\d+\t/.test(l))) {
    out = lines.map((l) => l.replace(/^[ \t]*\d+\t/, "")).join("\n")
  }
  return out
}

const DIFF_ROW_CLASS: Record<"context" | "added" | "removed", string> = {
  context: "",
  added: "bg-success/10",
  removed: "bg-destructive/10",
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
function DiffBlock({
  block,
  single,
}: {
  block: ToolCallContent & { type: "diff" }
  single?: boolean
}) {
  const rows = useMemo(
    () => foldContext(diffLines(block.oldText, block.newText)),
    [block.oldText, block.newText]
  )
  const lang = languageFor(block.path)
  return (
    <div data-testid="tool-content-diff">
      {single ? null : (
        <div className="border-b border-border px-2 py-1 font-mono text-xs break-all text-muted-foreground">
          {block.path}
        </div>
      )}
      <div
        className={`tool-output ${TOOL_OUTPUT_CAP} py-1 font-mono text-xs text-foreground`}
      >
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
                {row.text ? highlight(row.text, lang) : " "}
              </span>
            </div>
          )
        )}
      </div>
    </div>
  )
}

/** How an open row draws a text result. */
type OutputMode = "plain" | "prose" | "code" | "log" | "markdown"

/**
 * Render one ACP {@link ToolCallContent} block *structurally*: a file `diff`
 * as a line diff, an image as itself, and text as `mode` says (markdown,
 * highlighted code, a coloured log, prose in the UI font, or preformatted
 * text). `terminal` blocks never get here: see {@link shownContent}.
 */
function ToolContentBlock({
  block,
  single,
  mode = "plain",
  lang = null,
}: {
  block: Exclude<ToolCallContent, { type: "terminal" }>
  /** The call's only diff, whose path the row already names. */
  single?: boolean
  mode?: OutputMode
  lang?: string | null
}) {
  if (block.type === "diff") return <DiffBlock block={block} single={single} />
  if (block.content.type === "image") {
    const { data, mimeType } = block.content
    return (
      <div className="p-2">
        {/* A data URL the agent was sent; nothing for next/image to optimize. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt="What the agent saw"
          src={`data:${mimeType};base64,${data}`}
          className="max-h-48 max-w-full rounded-sm border border-border"
        />
      </div>
    )
  }
  const text =
    block.content.type === "text" ? cleanToolText(block.content.text) : ""
  if (mode === "markdown") {
    // Not pre-wrapped: markdown's own line breaks are not the output's.
    return (
      <div
        data-testid="tool-content-text"
        className="max-h-64 overflow-y-auto px-2 py-1.5"
      >
        <ChatMarkdown
          tone="default"
          size="xs"
          className="[&_h1]:text-xs [&_h1]:font-semibold [&_h2]:text-xs [&_h2]:font-semibold [&_h3]:text-xs [&_li]:my-0 [&_ol]:my-1 [&_p]:my-1 [&_ul]:my-1"
        >
          {text}
        </ChatMarkdown>
      </div>
    )
  }
  if (mode === "prose") {
    return (
      <div
        data-testid="tool-content-text"
        className={`${TOOL_OUTPUT_CAP} px-2 py-1.5 text-xs text-foreground`}
      >
        {text}
      </div>
    )
  }
  return (
    <pre
      data-testid="tool-content-text"
      className={cn(
        TOOL_OUTPUT_CAP,
        "px-2 py-1.5 font-mono text-xs text-foreground",
        mode === "code" && "tool-output"
      )}
    >
      {mode === "code" ? (
        highlight(text, lang)
      ) : mode === "log" ? (
        <>
          <style href="ansi-palette" precedence="default">
            {ANSI_PALETTE_CSS}
          </style>
          <LogText text={text} />
        </>
      ) : (
        text
      )}
    </pre>
  )
}

/**
 * A tool call's content as the row shows it. Without its `terminal` blocks:
 * we never create ACP terminals, so a terminal id resolves to nothing;
 * codex-acp sends one for a running command anyway and swaps in the output
 * text when it finishes, so the row's title and status carry it until then.
 * Without the input claude-agent-acp echoes as a ```json block for a tool it
 * doesn't know (ours among them) until the result replaces it: the row
 * already names what the input says. A hosted command's output without the
 * parts that say nothing, and a frame tool's with its frames named as a
 * person would.
 */
function shownContent(
  message: AgentMessage & { role: "tool_call" },
  rewrite: ToolDescription["rewrite"]
) {
  return message.content.flatMap(
    (b): Exclude<ToolCallContent, { type: "terminal" }>[] => {
      if (b.type === "terminal") return []
      if (b.type !== "content" || b.content.type !== "text") return [b]
      if (echoesInput(b.content.text, message.rawInput)) return []
      if (rewrite === "frame-names") {
        const text = readableFrameNames(b.content.text)
        return [{ ...b, content: { ...b.content, text } }]
      }
      if (rewrite !== "command-output") return [b]
      const text = commandOutput(b.content.text)
      return text.trim() ? [{ ...b, content: { ...b.content, text } }] : []
    }
  )
}

/** The text of a failed call's output, or null when it reported none. */
function hasFailureText(
  content: Exclude<ToolCallContent, { type: "terminal" }>[]
): boolean {
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
        <TooltipContent side="top" align="start" className="max-w-sm break-all">
          {fullText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** A row label's subject: plain text, or keycaps for keys. */
function LabelDetail({ named }: { named: RowLabel }) {
  if (!named.detail) return null
  if (named.as === "key") {
    return (
      <KbdGroup className="align-baseline">
        {named.detail.split(" ").map((k) => (
          <Kbd key={k} className="h-4 text-xs">
            {k}
          </Kbd>
        ))}
      </KbdGroup>
    )
  }
  return <span data-row-detail>{named.detail}</span>
}

/**
 * The one tool-call row (issue #728), keyed by id and advancing through its
 * status lifecycle in place: running shows the progress spinner, done shows the
 * tool's icon, and failed shows the reason — its output, or a line saying none
 * was reported — without needing to be opened. A row only expands when it has
 * output to show beyond what its label says. The whole row is in the UI font.
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
  // Every engine's call reads as a verb plus what it acted on, the same for
  // the same action (tool-description.ts). A Workspace a Coordinator tool
  // names reads by its title.
  const tasks = useWorkspaceTasks()
  const described = describeToolCall(message, {
    workspaceTitle: (id) => {
      const branch = tasks?.branches.find((b) => b.id === id)
      return branch?.title?.trim() || null
    },
  })
  const { label: named } = described
  const content = shownContent(message, described.rewrite)
  const hasContent = content.length > 0 && !described.quiet
  const lang = languageFor(described.readPath)
  const mode: OutputMode =
    described.output === "markdown"
      ? "markdown"
      : lang
        ? "code"
        : described.output

  const title = named.title ? (
    renderTitleWithCode(named.verb)
  ) : (
    <>
      {named.verb}
      {named.detail ? (
        <>
          {" "}
          <LabelDetail named={named} />
        </>
      ) : null}
    </>
  )
  const fullText = named.title
    ? named.verb.replace(/`/g, "")
    : [named.verb, named.detail].filter(Boolean).join(" ")

  // One diff whose file the row already names needs no path header.
  const diffs = content.filter((b) => b.type === "diff")
  const single =
    diffs.length === 1 &&
    fullText.includes(diffs[0]!.path.split("/").at(-1) ?? diffs[0]!.path)
  const RowIcon = TOOL_ICONS[described.icon]
  const icon = running ? (
    <Spinner
      data-testid="tool-call-spinner"
      aria-label="Running"
      className="size-3 shrink-0"
    />
  ) : failed ? (
    <WarningCircleIcon
      aria-label="Failed"
      className="size-3 shrink-0 text-destructive"
    />
  ) : (
    <RowIcon aria-hidden className="size-3 shrink-0" />
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
        {hasFailureText(content) ? (
          content.map((block, i) => (
            <ToolContentBlock key={i} block={block} mode={mode} lang={lang} />
          ))
        ) : (
          <p
            data-testid="tool-call-no-reason"
            className="px-2 py-1.5 text-xs text-destructive"
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
          {content.map((block, i) => (
            <ToolContentBlock
              key={i}
              block={block}
              single={single}
              mode={mode}
              lang={lang}
            />
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
            <WarningCircleIcon
              aria-label="Failed"
              className="size-3 shrink-0 text-destructive"
            />
          ) : (
            <RobotIcon aria-hidden className="size-3 shrink-0" />
          )
        }
        title={renderTitleWithCode(task.title)}
        meta={
          <span className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">
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
 * A Frame Drive folded into one row ({@link foldFrameDrives}): "Used
 * Checkout", with its step count, opening onto the steps. The person watches
 * the frame while it's driven, so it stays closed while it runs; its spinner
 * and count carry the progress, and a failed step marks the row.
 */
export function FrameDriveGroup({
  steps,
}: {
  steps: (AgentMessage & { role: "tool_call" })[]
}) {
  const [expanded, setExpanded] = useState(false)
  const running = steps.some(
    (s) => s.status === "pending" || s.status === "in_progress"
  )
  const failed = steps.some((s) => s.status === "failed")
  const page = driveName(steps) ?? "the frame"
  return (
    <ChatDisclosure
      open={expanded}
      onOpenChange={setExpanded}
      icon={
        running ? (
          <Spinner aria-label="Running" className="size-3 shrink-0" />
        ) : failed ? (
          <WarningCircleIcon
            aria-label="Failed"
            className="size-3 shrink-0 text-destructive"
          />
        ) : (
          <CursorIcon aria-hidden className="size-3 shrink-0" />
        )
      }
      title={
        <TruncatedTitle fullText={`${running ? "Using" : "Used"} ${page}`}>
          {running ? "Using" : "Used"} <span data-row-detail>{page}</span>
        </TruncatedTitle>
      }
      meta={
        <span className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">
          {steps.length} {steps.length === 1 ? "step" : "steps"}
        </span>
      }
      headerProps={{ "data-testid": "frame-drive" }}
    >
      <div className="space-y-2 py-2 pr-2 pl-3">
        {steps.map((step) => (
          <ToolCallRow key={step.toolCallId} message={step} />
        ))}
      </div>
    </ChatDisclosure>
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
        className="group/summary flex max-w-full min-w-0 items-start gap-1.5 rounded-md py-0.5 pr-1 text-left text-xs leading-5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <CaretRightIcon
          aria-hidden
          className="mt-1 size-3 shrink-0 transition-transform group-data-[state=open]/summary:rotate-90"
        />
        <span className="min-w-0">
          {summary.text}
          {/* A space, not a margin, so the chip starts flush when it wraps. */}
          {failures.length > 0 && " "}
          {failures.length > 0 && (
            // Inline, so it follows the text onto a wrapped line.
            <Badge
              variant="destructive"
              data-testid="turn-summary-failure"
              className="gap-1 px-1.5 align-top whitespace-nowrap"
            >
              <WarningCircleIcon aria-hidden className="size-3 shrink-0" />
              {failures.length === 1
                ? `${failures[0]} failed`
                : `${failures.length} failed`}
            </Badge>
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
 *
 * A `\` hard break at a line end becomes two trailing spaces: the same break
 * once sent, without a stray backslash in the composer. Code blocks and an
 * escaped `\\` are content and stay as written.
 */
export function quotePlan(content: string): string {
  let fence: string | null = null
  const quoted = content
    .trim()
    .split("\n")
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
      if (marker && (!fence || marker.startsWith(fence))) {
        fence = fence ? null : marker
      } else if (!fence) {
        const trailing = /\\+$/.exec(line)?.[0].length ?? 0
        if (trailing % 2 === 1) line = `${line.slice(0, -1)}  `
      }
      return line ? `> ${line}` : ">"
    })
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
      <Badge
        variant="outline"
        className="h-4 gap-1 px-1.5 py-0 text-xs text-success"
      >
        <CheckCircleIcon className="size-3 text-success" /> Approved
      </Badge>
    ),
    rejected: (
      <Badge variant="destructive" className="h-4 gap-1 px-1.5 py-0 text-xs">
        <XCircleIcon className="size-3" /> Changes requested
      </Badge>
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
      icon={<ClipboardTextIcon aria-hidden className="size-3 shrink-0" />}
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
              onClick={handleApprove}
              disabled={isSubmitting}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRequestChanges}
              disabled={isSubmitting}
            >
              Request changes
            </Button>
          </div>
        )}
        {isRejected && message.feedback && (
          <div className="mt-3 rounded-md border border-border bg-background/60 p-2">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <XCircleIcon className="size-3" /> Your feedback
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

  // A thinking block whose text the model withheld has nothing to disclose.
  if (!message.content.trim()) return null

  return (
    <ChatDisclosure
      open={expanded}
      onOpenChange={setExpanded}
      icon={<LightbulbIcon aria-hidden className="size-3 shrink-0" />}
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
        <InlineRef kind="element" className="font-mono">
          {children}
        </InlineRef>
      </HoverCardTrigger>
      <HoverCardContent align="start">
        <ElementDetail
          selector={detail.selector}
          route={detail.route}
          frameLabel={detail.frameLabel}
          inMockup={detail.layerKind === "mockup"}
        />
      </HoverCardContent>
    </HoverCard>
  )
}

/**
 * A drawn Mockup named in a sent message, by its live title (the box is empty
 * and untitled when the message is sent; the chat titles it).
 */
function MockupRef({ id }: { id: string }) {
  const title = useMockupTitle(id)
  return <InlineRef kind="mockup">{title || "Mockup"}</InlineRef>
}

/**
 * The sent user-message bubble. Split into its own component so it can memoize
 * the markdown `components` map and the targeted-element detail against the
 * message: the element-token highlight re-renders the Canvas subtree
 * this lives in, and a fresh `components` object each render would remount every
 * token (see `ElementHistoryToken`). Memoizing keeps the token instances stable
 * so an open HoverCard survives those re-renders.
 */
function UserMessage({
  message,
  roomId,
  sender,
}: {
  message: AgentMessage & { role: "user" }
  roomId?: string
  sender?: ChatSender
}) {
  // A Coordinator wake is the server's report on a Workspace turn, not
  // something anyone said (#897).
  if (message.wakeFrom) return null
  if (message.delegatedFrom)
    return <DelegatedMessage message={message} roomId={roomId} />
  if (!sender) return <UserBubble message={message} roomId={roomId} />
  return (
    <div className="flex flex-col gap-1">
      <SenderLabel sender={sender} />
      <UserBubble message={message} roomId={roomId} />
    </div>
  )
}

/** Who sent a message, over its bubble, on a shared Canvas. */
function SenderLabel({ sender }: { sender: ChatSender }) {
  return (
    <span
      data-testid="message-sender"
      className="flex max-w-[85%] items-center gap-1.5 self-end text-xs text-muted-foreground"
    >
      {sender.avatar && (
        <Avatar className="size-4">
          <AvatarImage src={sender.avatar} alt="" />
        </Avatar>
      )}
      <span className="truncate">{sender.name}</span>
    </span>
  )
}

/**
 * A Delegated Message (#896): a turn the Coordinator sent into this Workspace
 * chat. One muted line, like a finished turn's summary, that opens to the
 * message, so the chat stays readable and what it was asked stays one click
 * away.
 */
function DelegatedMessage({
  message,
  roomId,
}: {
  message: AgentMessage & { role: "user" }
  roomId?: string
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      data-testid="delegated-message"
    >
      <CollapsibleTrigger className="group/delegated flex max-w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 pr-1 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        <CaretRightIcon
          aria-hidden
          className="size-3 shrink-0 transition-transform group-data-[state=open]/delegated:rotate-90"
        />
        Received a message from the Coordinator
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1.5 pl-4.5">
        <UserBubble message={message} roomId={roomId} align="start" />
      </CollapsibleContent>
    </Collapsible>
  )
}

function UserBubble({
  message,
  roomId,
  align = "end",
}: {
  message: AgentMessage & { role: "user" }
  /** The canvas whose files the message's attachments open from. */
  roomId?: string
  align?: "start" | "end"
}) {
  // The user-turn projection already stripped the server prefixes and the
  // footers; recover the inline chips: `skillMarkersToPills` for the
  // `/`-skill marker and `elementMarkersToPills` for each `[element: …]`
  // element token — the same markers the composer's `serializeSkill` /
  // `serializeElement` emit, rendered back as inline references below — and
  // `mockupMarkersToRefs` for a drawn Mockup's `[mockup: <id>]`.
  const displayContent = useMemo(
    () =>
      mockupMarkersToRefs(
        elementMarkersToPills(skillMarkersToPills(message.content))
      ),
    [message.content]
  )
  // The terse inline label hides the messy detail; the projection carries it,
  // keyed by the same `ref` the inline `element:` link carries, so each
  // history token can hang a hover card off it.
  const targetedElements = useMemo(
    () => new Map((message.targetedElements ?? []).map((e) => [e.ref, e])),
    [message.targetedElements]
  )
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children, ...props }) => {
        // Inline references, as the composer draws them: a `/`-skill keeps
        // its `/`; an `@`-document trades its `@` for the document icon.
        if (typeof href === "string" && href.startsWith("skill:")) {
          return <InlineRef kind="skill">{children}</InlineRef>
        }
        if (typeof href === "string" && href.startsWith("mention:")) {
          return <InlineRef kind="document">{stripAt(children)}</InlineRef>
        }
        // A drawn Mockup, by its live title.
        if (typeof href === "string" && href.startsWith("mockup:")) {
          return <MockupRef id={href.slice("mockup:".length)} />
        }
        // element tokens: the crosshair + `font-mono` tag name,
        // matching the composer token. Detail rides the footer, keyed by the
        // link's `element:<ref>`; missing (a footer-less legacy turn) → plain
        // token, no card.
        if (typeof href === "string" && href.startsWith("element:")) {
          const refId = href.slice("element:".length)
          const detail = targetedElements.get(refId)
          if (!detail) {
            return (
              <InlineRef kind="element" className="font-mono">
                {children}
              </InlineRef>
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

  const attachments = message.attachments ?? []

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        align === "end" ? "items-end" : "items-start"
      )}
    >
      {attachments.length > 0 && roomId && (
        // The files sent with it (#1525), over the text the way they sat in
        // the composer; each opens the file.
        <div
          aria-label="Attachments"
          className={cn(
            "flex max-w-[85%] flex-wrap gap-1.5",
            align === "end" && "justify-end"
          )}
        >
          {attachments.map((a) => (
            <SentAttachmentChip
              key={a.path}
              path={a.path}
              mediaType={a.mediaType}
              href={attachmentUrl(roomId, a.path)}
            />
          ))}
        </div>
      )}
      {(displayContent.trim() || attachments.length === 0) && (
        <ChatMarkdown
          tone="bubble"
          urlTransform={(url) => url}
          components={components}
          className="max-w-[85%] rounded-xl bg-muted px-3 py-1.5 dark:bg-input/70"
        >
          {displayContent}
        </ChatMarkdown>
      )}
    </div>
  )
}

/**
 * An agent reply. In the Coordinator's transcript, a `[title](workspace:<id>)`
 * link names a Workspace by its state and title and opens it (#897), and a
 * `[title](frame:<id>)`, `document:` or `mockup:` link names that layer and
 * shows it on the canvas. Anywhere else they read as references that do
 * nothing.
 */
function AssistantMessage({ content }: { content: string }) {
  const tasks = useWorkspaceTasks()
  const facts = useMemo(
    () =>
      tasks &&
      roomWorkspaceFacts(tasks.chatSessions, tasks.plans, tasks.openQuestions),
    [tasks]
  )
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children, ...props }) => {
        const layer = typeof href === "string" ? parseLayerLink(href) : null
        if (layer) {
          const onShow = tasks?.onShow
          return (
            <InlineRef
              kind={layer.kind}
              onClick={onShow && (() => onShow(layer.id))}
            >
              {children}
            </InlineRef>
          )
        }
        if (
          typeof href !== "string" ||
          !href.startsWith(WORKSPACE_LINK_SCHEME)
        ) {
          return (
            <a href={href} {...props}>
              {children}
            </a>
          )
        }
        const branchId = href.slice(WORKSPACE_LINK_SCHEME.length)
        const branch = tasks?.branches.find((b) => b.id === branchId)
        if (!tasks || !facts || !branch) return <span>{children}</span>
        // Led by the Workspace's state; it opens the Workspace in place.
        return (
          <InlineRef
            kind="workspace"
            data-testid="workspace-link"
            icon={
              <WorkspaceStateGlyph line={workspaceState(branch, facts).line} />
            }
            onClick={() => tasks.onOpen({ branchId })}
          >
            {children}
          </InlineRef>
        )
      },
    }),
    [tasks, facts]
  )
  return (
    <ChatMarkdown components={components} urlTransform={keepReferenceLinks}>
      {content}
    </ChatMarkdown>
  )
}

/**
 * Markdown's default URL filter, letting `workspace:`, `frame:`, `document:`
 * and `mockup:` links through.
 */
function keepReferenceLinks(url: string): string {
  return url.startsWith(WORKSPACE_LINK_SCHEME) || parseLayerLink(url)
    ? url
    : defaultUrlTransform(url)
}

/** A mention's text without its leading `@`: the icon marks it now. */
function stripAt(children: ReactNode): ReactNode {
  if (typeof children === "string") return children.replace(/^@/, "")
  if (Array.isArray(children) && typeof children[0] === "string")
    return [children[0].replace(/^@/, ""), ...children.slice(1)]
  return children
}

/**
 * A tool call, or, in the Coordinator's transcript, a Workspace task row when
 * the call names a Workspace (#896).
 */
function ToolCallItem({
  message,
  roomId,
  chatId,
  questionAnswer,
  senders,
}: {
  message: AgentMessage & { role: "tool_call" }
  roomId?: string
  chatId?: string
  questionAnswer?: QuestionAnswer
  senders?: Map<string, ChatSender> | null
}) {
  const tasks = useWorkspaceTasks()
  if (isQuestionCall(message) && parseQuestion(message.rawInput)) {
    const by = questionAnswer?.by ? senders?.get(questionAnswer.by) : undefined
    return (
      <QuestionCard
        message={message}
        chatId={chatId}
        answer={questionAnswer}
        answeredBy={by?.name}
      />
    )
  }
  if (roomId && isSaveSkillCall(message)) {
    return (
      <SkillSaveCard
        message={message}
        roomId={roomId}
        fallback={<ToolCallRow message={message} />}
      />
    )
  }
  const found = tasks ? workspaceTasksOf(message) : []
  if (tasks && found.length > 0) {
    return (
      <div className="flex flex-col gap-1">
        {found.map((task) => (
          <WorkspaceTaskRow
            key={task.branchId}
            call={message}
            task={task}
            tasks={tasks}
          />
        ))}
      </div>
    )
  }
  return <ToolCallRow message={message} />
}

export function AgentMessageItem({
  message,
  roomId,
  chatId,
  onRetry,
  questionAnswer,
  senders,
}: {
  message: AgentMessage
  roomId?: string
  chatId?: string
  /** Retry for an error the chat can redo (a failed turn, approval or stop). */
  onRetry?: () => Promise<unknown>
  /** How a question card was answered, once a user message follows it. */
  questionAnswer?: QuestionAnswer
  /**
   * Who sent the chat's messages, by user id: present in the hosted build on
   * a shared Canvas, where messages and question answers name their sender.
   */
  senders?: Map<string, ChatSender> | null
}) {
  switch (message.role) {
    case "user":
      return (
        <UserMessage
          message={message}
          roomId={roomId}
          sender={message.sentBy ? senders?.get(message.sentBy) : undefined}
        />
      )

    case "assistant":
      return <AssistantMessage content={message.content} />

    case "reasoning":
      return <ReasoningMessage message={message} />

    case "tool_call":
      return (
        <ToolCallItem
          message={message}
          roomId={roomId}
          chatId={chatId}
          questionAnswer={questionAnswer}
          senders={senders}
        />
      )

    case "plan":
      if (!roomId || !chatId) return null
      return <PlanMessage message={message} roomId={roomId} chatId={chatId} />

    case "error":
      return <ErrorMessage message={message} onRetry={onRetry} />

    case "stopped":
      // A rule across the transcript rather than a bubble: it marks where the
      // run was cut short, so the turn above doesn't read as a finished one.
      return (
        <div
          role="note"
          data-testid="run-stopped"
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <span className="h-px flex-1 bg-border" />
          <span className="flex items-center gap-1">
            <SquareIcon weight="fill" className="size-2" />
            Stopped
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )
  }
}

/**
 * An error in the transcript: one plain sentence, with Retry where the chat can
 * redo what failed and the raw error behind Copy error, as the Workspace setup
 * failure card has it.
 */
function ErrorMessage({
  message,
  onRetry,
}: {
  message: AgentMessage & { role: "error" }
  onRetry?: () => Promise<unknown>
}) {
  const [retrying, setRetrying] = useState(false)
  const { detail } = message
  const copyError = () => {
    if (!detail) return
    void navigator.clipboard
      ?.writeText(detail)
      .then(() => toast.success("Error copied"))
      .catch(() => toast.error("Couldn’t copy the error"))
  }
  return (
    <div
      data-testid="chat-error"
      className="flex items-start gap-1.5 rounded-md border py-1 pr-1 pl-2 text-xs"
    >
      <WarningCircleIcon
        aria-hidden
        className="mt-1.5 size-3 shrink-0 text-destructive"
      />
      {/* Wraps anywhere: an older error may still be one long URL or stack
          line with no spaces to break on. */}
      <p className="min-w-0 flex-1 py-1 [overflow-wrap:anywhere] whitespace-pre-wrap">
        {message.content}
      </p>
      {detail && (
        <Button variant="ghost" size="xs" onClick={copyError}>
          <CopyIcon />
          Copy error
        </Button>
      )}
      {onRetry && (
        <Button
          variant="outline"
          size="xs"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true)
            try {
              await onRetry()
            } finally {
              setRetrying(false)
            }
          }}
        >
          {retrying && <Spinner />}
          Retry
        </Button>
      )}
    </div>
  )
}
