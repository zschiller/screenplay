import type { AgentMessage } from "./types"
import type { RunStatus } from "./run-state"
import { planResolutionText } from "./acp/resolution"
import { prependTurnMarkers } from "./message-markers"
import { bareToolName } from "./tool-name"
import { workspaceLink } from "./workspace-task"

/**
 * Coordinator wakes (#897): after every Workspace turn ends, the server starts
 * a Coordinator turn carrying how it ended. Isomorphic and free of the live
 * database, so Turn Launch and the tests share it; the live wiring is in
 * `coordinator-wake-live.ts`.
 */

/** The run states that end a Workspace turn and wake the Coordinator. */
export type WakeStatus = Extract<
  RunStatus,
  "completed" | "failed" | "aborted" | "paused_for_plan"
>

const WAKE_STATUSES: ReadonlySet<RunStatus> = new Set<WakeStatus>([
  "completed",
  "failed",
  "aborted",
  "paused_for_plan",
])

/**
 * Whether a run that just stopped driving wakes the Coordinator. `superseded`
 * doesn't: a newer turn replaced it and wakes it in turn.
 */
export function isWakeStatus(status: RunStatus): status is WakeStatus {
  return WAKE_STATUSES.has(status)
}

/**
 * Whether a chat's turn that just ended wakes the Coordinator. Like a project's
 * coordinator, it hears about the work it handed out and about failures, not
 * about a chat someone is already in: a turn wakes it when it failed, or when
 * the chat's current task came from the Coordinator. The current task is the
 * latest message a person or the Coordinator sent; a plan approval carries on
 * the task the plan was for. A PR event's turn (#1703) wakes it only when it
 * failed: the chat already shows the event and what the agent did.
 */
export function wakesOnTurnEnd(
  transcript: readonly AgentMessage[],
  status: WakeStatus
): boolean {
  if (status === "failed") return true
  const asks = transcript.filter(
    (m): m is Extract<AgentMessage, { role: "user" }> => m.role === "user"
  )
  if (asks.at(-1)?.prEvent) return false
  // The approval a plan decision resumes a chat with, as its next user turn.
  const approval = planResolutionText({ approved: true })
  for (const ask of [...asks].reverse()) {
    if (ask.prEvent || ask.wakeFrom) continue
    if (ask.content.trim() === approval) continue
    return Boolean(ask.delegatedFrom)
  }
  return false
}

/**
 * How many follow-ups the Coordinator may send on its own, from wakes, before
 * the user says anything (Claude Projects' two-reply rule).
 */
export const WAKE_FOLLOW_UP_LIMIT = 2

/** The Coordinator tools that hand a chat work. */
const FOLLOW_UP_TOOL_NAMES: ReadonlySet<string> = new Set([
  "send_to_workspace",
  "create_workspaces",
  "start_chat",
  "send_to_chat",
])

/**
 * The follow-ups the Coordinator sent on its own since the user last wrote to
 * it: earlier wake turns that started or messaged a chat. The turn running now
 * (the transcript's last) doesn't count, so one wake that messages two chats
 * is one follow-up.
 */
export function wakeFollowUps(transcript: readonly AgentMessage[]): number {
  let count = 0
  let wake = false
  let delegated = false
  const close = () => {
    if (wake && delegated) count++
  }
  for (const m of transcript) {
    if (m.role === "user") {
      close()
      // A message from the user starts the count over.
      if (!m.wakeFrom) count = 0
      wake = Boolean(m.wakeFrom)
      delegated = false
    } else if (
      m.role === "tool_call" &&
      m.status !== "failed" &&
      FOLLOW_UP_TOOL_NAMES.has(bareToolName(m.title))
    ) {
      delegated = true
    }
  }
  return count
}

/** A Workspace chat's turn that just ended. */
export interface WorkspaceTurnEnd {
  roomId: string
  chatId: string
  runId: string
  status: WakeStatus
}

const ENDING: Record<WakeStatus, string> = {
  completed: "finished its turn",
  failed: "ended its turn with an error",
  aborted: "was stopped by the user",
  paused_for_plan: "is waiting for the user to approve its plan",
}

/**
 * The Coordinator turn's message for a Workspace turn that ended: which
 * Workspace, how its turn ended, and `lastTurn` (the last ask, turn summary
 * and last reply, as `read_workspace_chat` renders them). It carries the
 * `[workspace update: …]` marker, so the Coordinator chat never shows it.
 */
export function wakeMessage(input: {
  workspaceId: string
  title: string
  status: WakeStatus
  lastTurn: string
  /**
   * True when `workspaceId` is a chat with no repository (a Sketch Chat),
   * which has no Workspace to link.
   */
  sketch?: boolean
}): string {
  const { workspaceId, title, status, lastTurn } = input
  const link = input.sketch
    ? `"${title}" (a chat with no repository) [chat ${workspaceId}]`
    : workspaceLink(title, workspaceId)
  const subject = input.sketch ? "Chat" : "Workspace"
  const nudge = [
    "Its card in your chat, when it has one, already shows how it ended (Ready, Needs you, Failed, Stopped), and its reply is in its own chat, so don’t restate its result, and don’t say it’s waiting on a plan or a question.",
    "Write only for a blocker the card can’t show (why it failed or what stops it going on) or a decision only the user can make, in one or two lines.",
    "If the user, or a skill you’re following, asked you to do something once this chat finished, do it now. Otherwise end your turn without writing anything.",
  ].join(" ")
  return prependTurnMarkers(
    [
      `${subject} ${link} ${ENDING[status]}. This is an automatic update, not a message from the user.`,
      "",
      lastTurn,
      "",
      nudge,
    ].join("\n"),
    { wakeFrom: workspaceId }
  )
}

/**
 * The stock lines a harness writes when a wake needs no answer (#1224):
 * "No response requested.", "No reply needed.", "(nothing to add)" and close
 * variants. Claude Code sometimes writes one instead of ending its turn
 * silently; a wake turn drops it rather than showing it.
 */
const NO_REPLY_RE =
  /^(?:no (?:response|reply|answer|message|update|action)s?(?: (?:is |was )?(?:requested|needed|necessary|required))?|nothing (?:to (?:say|add|report|do)|new)(?: here)?)$/

/**
 * The longest reply that can still be a no-reply line, so a wake turn only
 * holds back that much of a reply before it can tell.
 */
export const NO_REPLY_MAX_LENGTH = 48

/** Whether a wake turn's reply says nothing: empty, or a stock no-reply line. */
export function isNoReply(text: string): boolean {
  const core = text
    .trim()
    .toLowerCase()
    .replace(/^[\s("'*_`]+|[\s)"'*_`.!]+$/g, "")
    .replace(/\s+/g, " ")
  return core === "" || NO_REPLY_RE.test(core)
}

/**
 * Runs tasks one at a time per key, in the order they were queued; different
 * keys run side by side. A failed task doesn't stop the ones behind it.
 */
export function createKeyedQueue() {
  const tails = new Map<string, Promise<void>>()
  return function enqueue(key: string, task: () => Promise<void>) {
    const previous = tails.get(key) ?? Promise.resolve()
    const run = previous.then(task)
    const tail = run.catch(() => {})
    tails.set(key, tail)
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key)
    })
    return run
  }
}
