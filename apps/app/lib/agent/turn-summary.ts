import type { AgentMessage } from "@/lib/agent/types"
import type { GroupedMessage } from "@/lib/agent/group-tool-calls"
import { workspaceTasksOf } from "@/lib/agent/workspace-task"
import { bareToolName } from "@/lib/agent/tool-name"
import { isNoReply } from "@/lib/agent/coordinator-wake"
import { isQuestionCall } from "@/lib/agent/question"

type ToolCallMessage = Extract<AgentMessage, { role: "tool_call" }>

/**
 * One row of the rendered transcript: a message as-is, or a finished turn's
 * steps folded behind one summary line (issue #800).
 */
export type TranscriptItem =
  | { kind: "message"; entry: GroupedMessage }
  | {
      kind: "turn-summary"
      /** The first folded entry's flat index, for a stable React key. */
      index: number
      steps: GroupedMessage[]
      summary: TurnSummary
    }

export interface TurnSummary {
  /** "Read 3 files, edited 1 file, ran 2 commands". */
  text: string
  /** A short name per failed call ("pnpm lint", "edit"), in order. */
  failures: string[]
}

/** Kinds that always stay on screen, even in a folded turn. */
const PINNED_ROLES = new Set<AgentMessage["role"]>(["plan", "error", "stopped"])

/**
 * Whether an entry stays on screen in a folded turn: a pinned kind, a
 * Coordinator call that names a Workspace, whose task row is the point of the
 * turn (#896), or a question card (#1312), which shows what was asked and
 * answered.
 */
function isPinned(message: AgentMessage): boolean {
  if (PINNED_ROLES.has(message.role)) return true
  if (isQuestionCall(message)) return true
  return isCard(message)
}

function isCard(message: AgentMessage): boolean {
  return message.role === "tool_call" && workspaceTasksOf(message).length > 0
}

/**
 * Whether the entry at `i` is the Coordinator message that started the chats
 * whose cards follow it (#1318): an assistant message whose next entry is a
 * chat card. It stays on screen in a folded turn, so each card sits under the
 * message that started it rather than under a summary line.
 */
function startsCards(turn: GroupedMessage[], i: number): boolean {
  const next = turn[i + 1]
  return turn[i]?.message.role === "assistant" && !!next && isCard(next.message)
}

/**
 * Fold each finished turn's steps behind one summary line.
 *
 * A turn is everything after a user message up to the next one. Once it has
 * finished (every turn but the last while a run streams), and if it made any
 * tool call, its tool calls, reasoning and interim narration fold into a
 * `turn-summary` item. The answer (the turn's last assistant message) stays
 * visible, as do plans, errors and the stopped marker: the summary sits where
 * the turn begins, then those follow in their original order. Workspace task
 * rows (chat cards) stay visible too, with the message just before them that
 * started them, and a turn whose only calls are task rows stays flat.
 *
 * A turn still streaming renders flat, so a run in progress shows its live
 * steps. With `liveFrom`, the index where the running turn began, that is
 * every turn from there on: a message the agent took mid-run (a Steer, #1190)
 * starts a turn of its own, but its run hasn't finished, so nothing before it
 * folds until the run ends.
 *
 * A Coordinator wake's message (#897) is left out, and so is the work its
 * turn did, live or finished: like a project chat, the Coordinator's panel
 * shows only its replies and what stays pinned (task rows, plans, errors). A
 * wake turn shows its last reply, and while it runs, the reply being written.
 */
export function foldFinishedTurns(
  entries: GroupedMessage[],
  { streaming, liveFrom }: { streaming: boolean; liveFrom?: number | null }
): TranscriptItem[] {
  const turns: GroupedMessage[][] = [[]]
  // The turns that answer a Coordinator wake, by index.
  const wakeTurns = new Set<number>()
  for (const entry of entries) {
    if (entry.message.role === "user") {
      turns.push([entry], [])
      if (entry.message.wakeFrom) {
        wakeTurns.add(turns.length - 1)
      }
    } else turns[turns.length - 1].push(entry)
  }
  const lastTurn = turns.length - 1

  const items: TranscriptItem[] = []
  turns.forEach((turn, t) => {
    const live =
      streaming &&
      (t === lastTurn ||
        (liveFrom != null && turn.some((e) => e.index >= liveFrom)))
    const isUserTurn = turn.length === 1 && turn[0].message.role === "user"
    // The wake message is the server's, never drawn.
    if (isUserTurn && wakeTurns.has(t + 1)) return
    if (wakeTurns.has(t)) {
      const reply = wakeReplyIndex(turn, live)
      turn.forEach((entry, i) => {
        if (
          i === reply ||
          isPinned(entry.message) ||
          (!live && startsCards(turn, i))
        ) {
          items.push({ kind: "message", entry })
        }
      })
      return
    }
    // Reasoning alone is already one collapsed line, and a task row is the
    // work's own summary; fold only real work.
    const didWork = turn.some(
      (e) => e.message.role === "tool_call" && !isPinned(e.message)
    )
    if (live || isUserTurn || !didWork) {
      for (const entry of turn) items.push({ kind: "message", entry })
      return
    }

    let answer = -1
    turn.forEach((e, i) => {
      if (e.message.role === "assistant") answer = i
    })
    const steps: GroupedMessage[] = []
    const shown: GroupedMessage[] = []
    turn.forEach((e, i) => {
      if (i === answer || isPinned(e.message) || startsCards(turn, i))
        shown.push(e)
      else steps.push(e)
    })
    items.push({
      kind: "turn-summary",
      index: steps[0].index,
      steps,
      summary: summarizeSteps(steps),
    })
    for (const entry of shown) items.push({ kind: "message", entry })
  })
  return items
}

/**
 * The reply a wake turn shows: its last assistant message once finished;
 * while it runs, only a message still being written (the last entry), so the
 * narration between its reads never flashes up. A stock no-reply line
 * ("No response requested.", #1224) is no reply; the server drops those, and
 * this hides any a chat stored before it did.
 */
function wakeReplyIndex(turn: GroupedMessage[], live: boolean): number {
  let reply = -1
  if (live) {
    const last = turn.length - 1
    if (turn[last]?.message.role === "assistant") reply = last
  } else {
    turn.forEach((e, i) => {
      if (e.message.role === "assistant") reply = i
    })
  }
  const message = turn[reply]?.message
  return message?.role === "assistant" && isNoReply(message.content)
    ? -1
    : reply
}

type Category =
  | "read"
  | "edit"
  | "readDoc"
  | "editDoc"
  | "canvas"
  | "run"
  | "search"
  | "readCanvas"
  | "readWorkspace"
  | "viewFrame"
  | "listChanges"
  | "memory"
  | "view"
  | "drive"

const TITLE_CATEGORY: Record<string, Category> = {
  read_file: "read",
  write_file: "edit",
  edit_file: "edit",
  run_command: "run",
  read_document: "readDoc",
  replace_document_body: "editDoc",
  append_to_document_body: "editDoc",
  set_document_title: "editDoc",
  // The Coordinator's arrange tools (#894) change the canvas, not files.
  create_frames: "canvas",
  create_document: "canvas",
  move_group: "canvas",
  arrange_groups: "canvas",
  move_to_group: "canvas",
  merge_groups: "canvas",
  rename: "canvas",
  remove: "canvas",
  undo_changes: "canvas",
  // A Workspace chat opening a frame to drive (#1390).
  frame_open: "canvas",
  // The Coordinator's reads (#893).
  read_canvas: "readCanvas",
  read_workspace_chat: "readWorkspace",
  read_workspace_diff: "readWorkspace",
  view_frame: "viewFrame",
  read_frame_html: "viewFrame",
  frame_elements: "viewFrame",
  frame_screenshot: "viewFrame",
  // Driving a frame (#1389, #1390): every step counts toward one frame.
  frame_start_driving: "drive",
  frame_click: "drive",
  frame_type: "drive",
  frame_key: "drive",
  frame_scroll: "drive",
  frame_select: "drive",
  frame_drag: "drive",
  frame_hover: "drive",
  frame_stop_driving: "drive",
  list_changes: "listChanges",
  show_on_canvas: "view",
  write_memory: "memory",
}

const KIND_CATEGORY: Record<string, Category> = {
  read: "read",
  edit: "edit",
  delete: "edit",
  move: "edit",
  execute: "run",
  search: "search",
}

/**
 * The call's file path across engines (`path`, `file_path`, …), falling back to
 * the path on a diff it produced; null when it names none.
 */
function callPath(call: ToolCallMessage): string | null {
  const raw = call.rawInput
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>
    for (const key of [
      "path",
      "file_path",
      "filePath",
      "abs_path",
      "absPath",
    ]) {
      const v = r[key]
      if (typeof v === "string" && v) return v
    }
  }
  for (const block of call.content) if (block.type === "diff") return block.path
  return null
}

function categorize(call: ToolCallMessage): Category | null {
  // A harness reaches our tools over MCP, under its own namespace.
  const byTitle = TITLE_CATEGORY[bareToolName(call.title)]
  if (byTitle) return byTitle
  if (!call.kind) return null
  const byKind = KIND_CATEGORY[call.kind]
  // A read with no file (a skill, a directory listing) isn't "read a file".
  if (byKind === "read") return callPath(call) ? byKind : null
  return byKind ?? null
}

/** A command call's command line: its raw input, else an adapter's prose title. */
function commandLine(call: ToolCallMessage): string {
  const raw = call.rawInput
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>
    const line = [r.command, ...((r.args as string[] | undefined) ?? [])]
      .filter((w): w is string => typeof w === "string" && w !== "")
      .join(" ")
    if (line) return line
  }
  return bareToolName(call.title) === "run_command"
    ? ""
    : call.title.replace(/`/g, "")
}

/** The shortest name that says which call failed. */
function failureName(call: ToolCallMessage): string {
  const category = categorize(call)
  if (category === "run") {
    const words = commandLine(call).split(/\s+/).filter(Boolean)
    return words.length > 0 ? words.slice(0, 2).join(" ") : "Command"
  }
  if (category === "read" || category === "readDoc") return "Read"
  if (category === "edit" || category === "editDoc") return "Edit"
  if (category === "search") return "Search"
  if (category === "canvas") return "Canvas change"
  if (category === "readCanvas") return "Read canvas"
  if (category === "readWorkspace") return "Workspace read"
  if (category === "viewFrame") return "View frame"
  if (category === "listChanges") return "List changes"
  if (category === "memory") return "Save to memory"
  if (category === "view") return "Show on canvas"
  if (category === "drive") return "Frame step"
  return "A step"
}

/** The Workspace or frame a Coordinator read names, so repeats count once. */
function inputId(
  call: ToolCallMessage,
  category: "readWorkspace" | "viewFrame" | "drive"
): string | null {
  const raw = call.rawInput
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const id = record[category === "readWorkspace" ? "workspaceId" : "frameId"]
  if (typeof id === "string" && id) return id
  // A Frame Drive call with no frameId acts on the chat's own frame.
  return bareToolName(call.title).startsWith("frame_") ? "own frame" : null
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Describe a turn's steps in one line: what the agent read, edited and ran,
 * plus the name of every call that failed. Repeat reads or edits of the same
 * file count once.
 */
export function summarizeSteps(steps: GroupedMessage[]): TurnSummary {
  // A subagent counts once; its own calls stay inside it, bar their failures.
  const calls: ToolCallMessage[] = []
  const failed: ToolCallMessage[] = []
  let subagents = 0
  for (const { message, children } of steps) {
    if (message.role !== "tool_call") continue
    if (children.length > 0) subagents++
    else calls.push(message)
    if (message.status === "failed") failed.push(message)
    for (const child of children) {
      if (child.message.status === "failed") failed.push(child.message)
    }
  }

  const seen: Record<Category, Set<string>> = {
    read: new Set(),
    edit: new Set(),
    readDoc: new Set(),
    editDoc: new Set(),
    canvas: new Set(),
    run: new Set(),
    search: new Set(),
    readCanvas: new Set(),
    readWorkspace: new Set(),
    viewFrame: new Set(),
    listChanges: new Set(),
    memory: new Set(),
    view: new Set(),
    drive: new Set(),
  }
  let other = 0
  const failures = failed.map(failureName)
  for (const call of calls) {
    const category = categorize(call)
    if (!category) {
      other++
      continue
    }
    const key =
      category === "read" || category === "edit"
        ? (callPath(call) ?? call.toolCallId)
        : category === "readWorkspace" ||
            category === "viewFrame" ||
            category === "drive"
          ? (inputId(call, category) ?? call.toolCallId)
          : call.toolCallId
    seen[category].add(key)
  }

  const n = (c: Category) => seen[c].size
  const reads = n("read")
  const runs = [
    n("run") && plural(n("run"), "command", "commands"),
    subagents && plural(subagents, "subagent", "subagents"),
  ].filter((p): p is string => typeof p === "string")
  const parts = [
    reads && `read ${plural(reads, "file", "files")}`,
    // After "read N files", "edited 1" needs no noun of its own.
    n("edit") &&
      (reads
        ? `edited ${n("edit")}`
        : `edited ${plural(n("edit"), "file", "files")}`),
    n("readDoc") && "read the document",
    n("editDoc") && "edited the document",
    n("readCanvas") && "read the canvas",
    n("readWorkspace") &&
      `checked ${plural(n("readWorkspace"), "Workspace", "Workspaces")}`,
    n("viewFrame") && `viewed ${plural(n("viewFrame"), "frame", "frames")}`,
    n("listChanges") && "listed changes",
    n("canvas") && "changed the canvas",
    n("memory") && "saved to memory",
    n("view") && "moved the view",
    n("drive") && `drove ${plural(n("drive"), "frame", "frames")}`,
    runs.length > 0 && `ran ${runs.join(" and ")}`,
    n("search") && `searched ${plural(n("search"), "time", "times")}`,
  ].filter((p): p is string => typeof p === "string")
  // "other" only reads right after something it's other than.
  if (other) {
    parts.push(
      parts.length > 0
        ? `used ${plural(other, "other tool", "other tools")}`
        : `used ${plural(other, "tool", "tools")}`
    )
  }

  const text =
    parts.length > 0
      ? parts.join(", ").replace(/^./, (c) => c.toUpperCase())
      : "Worked"
  return { text, failures }
}
