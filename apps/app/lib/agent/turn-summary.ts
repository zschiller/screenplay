import type { AgentMessage } from "@/lib/agent/types"
import type { GroupedMessage } from "@/lib/agent/group-tool-calls"

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
 * Fold each finished turn's steps behind one summary line.
 *
 * A turn is everything after a user message up to the next one. Once it has
 * finished (every turn but the last while a run streams), and if it made any
 * tool call, its tool calls, reasoning and interim narration fold into a
 * `turn-summary` item. The answer (the turn's last assistant message) stays
 * visible, as do plans, errors and the stopped marker: the summary sits where
 * the turn begins, then those follow in their original order.
 *
 * A turn still streaming renders flat, so a run in progress shows its live
 * steps.
 */
export function foldFinishedTurns(
  entries: GroupedMessage[],
  { streaming }: { streaming: boolean }
): TranscriptItem[] {
  const turns: GroupedMessage[][] = [[]]
  for (const entry of entries) {
    if (entry.message.role === "user") turns.push([entry], [])
    else turns[turns.length - 1].push(entry)
  }
  const lastTurn = turns.length - 1

  const items: TranscriptItem[] = []
  turns.forEach((turn, t) => {
    const live = streaming && t === lastTurn
    const isUserTurn = turn.length === 1 && turn[0].message.role === "user"
    // Reasoning alone is already one collapsed line; fold only real work.
    const didWork = turn.some((e) => e.message.role === "tool_call")
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
      if (i === answer || PINNED_ROLES.has(e.message.role)) shown.push(e)
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

type Category =
  | "read"
  | "edit"
  | "readDoc"
  | "editDoc"
  | "canvas"
  | "run"
  | "search"

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
  move_to_group: "canvas",
  merge_groups: "canvas",
  rename: "canvas",
  remove: "canvas",
  undo_changes: "canvas",
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
  const byTitle = TITLE_CATEGORY[call.title]
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
  return call.title === "run_command" ? "" : call.title.replace(/`/g, "")
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
  return "A step"
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
    n("canvas") && "changed the canvas",
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
