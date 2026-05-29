import "server-only"

import { and, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"
import { db as defaultDb } from "@/lib/db"
import type { DB } from "@/lib/db"
import { agentRun } from "@/lib/db/schema"

/**
 * The truthful set of run states. Unlike the legacy `running | paused_for_plan
 * | ended` + `aborted` boolean, every terminal outcome has its own value, so
 * illegal combinations (an `ended` run that is also un-aborted but actually
 * failed) are simply unrepresentable.
 */
export type RunStatus =
  | "running"
  | "paused_for_plan"
  | "completed"
  | "failed"
  | "aborted"
  | "superseded"

const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "failed",
  "aborted",
  "superseded",
])

// Legal forward edges. Terminal states have no outgoing edges, which is what
// makes a late transition onto a finished run a no-op rather than a clobber.
const LEGAL_EDGES: Record<RunStatus, ReadonlySet<RunStatus>> = {
  running: new Set<RunStatus>([
    "completed",
    "failed",
    "aborted",
    "superseded",
    "paused_for_plan",
  ]),
  paused_for_plan: new Set<RunStatus>(["aborted", "superseded"]),
  completed: new Set<RunStatus>(),
  failed: new Set<RunStatus>(),
  aborted: new Set<RunStatus>(),
  superseded: new Set<RunStatus>(),
}

/**
 * The narrow persistence surface the state machine drives. Splitting it out
 * keeps the transition rules pure and lets tests exercise them against an
 * in-memory store instead of a live Postgres.
 */
export interface RunStateRepo {
  /** Current status of a run, or null if no such run exists. */
  loadStatus(runId: string): Promise<RunStatus | null>
  /** Persist a new status, stamping `endedAt` when one is supplied. */
  applyTransition(
    runId: string,
    to: RunStatus,
    endedAt: Date | null,
  ): Promise<void>
  /** Move every still-active run for a chat to `superseded`. */
  supersedeActiveRuns(chatId: string): Promise<void>
  /** Insert a fresh `running` run for a chat and return its id. */
  insertRunning(chatId: string): Promise<string>
}

export interface RunState {
  transition(runId: string, to: RunStatus): Promise<void>
  startRun(chatId: string): Promise<string>
  isRunActive(runId: string): Promise<boolean>
}

/**
 * Build a run-state machine over a persistence port. The guarded `transition`
 * is the only way status changes: it rejects illegal edges, no-ops on a run
 * that has already finished, and stamps `endedAt` on the terminal states.
 */
export function createRunState(repo: RunStateRepo): RunState {
  async function transition(runId: string, to: RunStatus): Promise<void> {
    const current = await repo.loadStatus(runId)
    if (current === null) {
      throw new Error(`Cannot transition unknown run ${runId}`)
    }
    // Already finished: a late /stop or a duplicate completion must not
    // clobber the recorded outcome.
    if (TERMINAL.has(current)) return
    if (!LEGAL_EDGES[current].has(to)) {
      throw new Error(`Illegal run transition: ${current} → ${to}`)
    }
    await repo.applyTransition(runId, to, TERMINAL.has(to) ? new Date() : null)
  }

  async function startRun(chatId: string): Promise<string> {
    // Any run still active for this chat is being abandoned in favour of the
    // new one — record that as superseded before inserting the replacement.
    await repo.supersedeActiveRuns(chatId)
    return repo.insertRunning(chatId)
  }

  async function isRunActive(runId: string): Promise<boolean> {
    return (await repo.loadStatus(runId)) === "running"
  }

  return { transition, startRun, isRunActive }
}

/**
 * Drizzle-backed port over the `agent_run` table. An "active" run is one that
 * has not finished — during the expand phase that means `running` or
 * `paused_for_plan` (the legacy `ended` and the new terminals are both done).
 */
function drizzleRepo(database: DB = defaultDb): RunStateRepo {
  return {
    async loadStatus(runId) {
      const [row] = await database
        .select({ status: agentRun.status })
        .from(agentRun)
        .where(eq(agentRun.id, runId))
        .limit(1)
      return (row?.status as RunStatus | undefined) ?? null
    },
    async applyTransition(runId, to, endedAt) {
      await database
        .update(agentRun)
        .set({ status: to, ...(endedAt ? { endedAt } : {}) })
        .where(eq(agentRun.id, runId))
    },
    async supersedeActiveRuns(chatId) {
      await database
        .update(agentRun)
        .set({ status: "superseded", endedAt: new Date() })
        .where(
          and(
            eq(agentRun.chatId, chatId),
            inArray(agentRun.status, ["running", "paused_for_plan"]),
          ),
        )
    },
    async insertRunning(chatId) {
      const id = nanoid()
      await database.insert(agentRun).values({ id, chatId, status: "running" })
      return id
    },
  }
}

// Default machine bound to the live database. Wiring the engine and routes onto
// these (and retiring the legacy helpers) is the contract half of the
// migration (#168–#170); for now they live alongside the old persistence
// helpers, which keep working unchanged.
const defaultRunState = createRunState(drizzleRepo())

export const transition = defaultRunState.transition
export const startRun = defaultRunState.startRun
export const isRunActive = defaultRunState.isRunActive
