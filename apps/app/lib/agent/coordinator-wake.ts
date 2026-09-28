import type { RunStatus } from "./run-state"
import { prependTurnMarkers } from "./message-markers"
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
}): string {
  const { workspaceId, title, status, lastTurn } = input
  const link = workspaceLink(title, workspaceId)
  const nudge =
    status === "paused_for_plan"
      ? `Tell the user that ${link} is waiting for them to approve its plan, in one line with that link. You can't approve plans; the user does.`
      : "Reply only if the user needs to hear a result, a blocker or a decision only they can make. Otherwise end your turn without writing anything."
  return prependTurnMarkers(
    [
      `Workspace ${link} ${ENDING[status]}. This is an automatic update, not a message from the user.`,
      "",
      lastTurn,
      "",
      nudge,
    ].join("\n"),
    { wakeFrom: workspaceId }
  )
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
