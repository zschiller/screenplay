import type { AgentMessage } from "@/lib/agent/types"
import type { GroupedMessage } from "@/lib/agent/group-tool-calls"
import { workspaceTasksOf } from "@/lib/agent/workspace-task"
import {
  describeToolCall,
  type SummaryCategory,
} from "@/lib/agent/tool-description"
import { isNoReply } from "@/lib/agent/coordinator-wake"
import { isQuestionCall } from "@/lib/agent/question"
import { PROPOSE_PLAN_TOOL } from "@/lib/agent/coordinator-plan"
import { bareToolName } from "@/lib/agent/tool-name"
import { deliveredFiles } from "@/lib/agent/delivered-files"

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
  | {
      kind: "files"
      /** The turn's first entry's flat index, for a stable React key. */
      index: number
      /** The Documents and Mockups the turn delivered (#1885), in order. */
      ids: string[]
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
 * turn (#896), a question card (#1312), which shows what was asked and
 * answered, a skill card (#1633), which waits for someone to save it, or a
 * merge card, which waits for someone to press Merge, a Marked done card
 * (#1705), which says why the chat closed, or the Coordinator's Plan card,
 * which waits for Approve.
 */
function isPinned(message: AgentMessage): boolean {
  if (PINNED_ROLES.has(message.role)) return true
  if (isQuestionCall(message)) return true
  if (
    message.role === "tool_call" &&
    ["save_skill", "merge_pr", "mark_done", PROPOSE_PLAN_TOOL].includes(
      bareToolName(message.title)
    )
  )
    return true
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
 * started them, and a turn whose only calls are task rows stays flat. The
 * Documents and Mockups the turn delivered follow its answer as one `files`
 * item, the reply's tiles (#1885).
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
    // The files the turn delivered show as tiles under its answer (#1885).
    const delivered = deliveredFiles(turn.map((e) => e.message))
    const files: TranscriptItem[] =
      delivered.length > 0
        ? [{ kind: "files", index: turn[0]!.index, ids: delivered }]
        : []

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
    for (const entry of shown) {
      items.push({ kind: "message", entry })
      if (entry === turn[answer]) items.push(...files.splice(0))
    }
    items.push(...files)
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
  for (const { message, children, drive } of steps) {
    if (message.role !== "tool_call") continue
    // A folded Frame Drive's steps count one by one, like flat ones.
    if (drive) {
      for (const child of children) {
        calls.push(child.message)
        if (child.message.status === "failed") failed.push(child.message)
      }
      continue
    }
    if (children.length > 0) subagents++
    else calls.push(message)
    if (message.status === "failed") failed.push(message)
    for (const child of children) {
      if (child.message.status === "failed") failed.push(child.message)
    }
  }

  const seen: Record<SummaryCategory, Set<string>> = {
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
  const failures = failed.map((call) => describeToolCall(call).failure)
  for (const call of calls) {
    const { category, summaryKey } = describeToolCall(call)
    if (!category) {
      other++
      continue
    }
    seen[category].add(summaryKey ?? call.toolCallId)
  }

  const n = (c: SummaryCategory) => seen[c].size
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
      `checked ${plural(n("readWorkspace"), "workspace", "workspaces")}`,
    n("viewFrame") && `viewed ${plural(n("viewFrame"), "frame", "frames")}`,
    n("listChanges") && "listed changes",
    n("canvas") && "changed the canvas",
    n("memory") && "saved to memory",
    n("view") && "moved the view",
    n("drive") && `used ${plural(n("drive"), "frame", "frames")}`,
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
