import "server-only"

import { and, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"
import { db as defaultDb } from "@/lib/db"
import type { DB } from "@/lib/db"
import { agentPendingToolCall, agentRun } from "@/lib/db/schema"

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

/**
 * A tool call halting a run for human approval (currently only `submit_plan`).
 * Carries the verbatim AI-SDK tool-call id, which becomes the pending row's
 * primary key — the same value the `plan_submitted` broadcast and the
 * history-route reconstruction key off, so a client's planId always resolves
 * back to this row.
 */
export interface PendingPlanCall {
  toolCallId: string
  chatId: string
  toolName: string
  input: Record<string, unknown>
}

/** The human decision on a pending plan. */
export interface PlanResolution {
  approved: boolean
  feedback?: string
}

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
  /**
   * Atomically pause a run for human plan approval: move it
   * `running → paused_for_plan` **and** insert its pending tool-call row in a
   * single transaction. A failure inside (e.g. a duplicate tool-call id) rolls
   * back both — neither write lands, so the two tables can never desync.
   */
  pauseForPlan(runId: string, planCall: PendingPlanCall): Promise<void>
  /**
   * Atomically resolve a pending plan: mark its tool-call `approved`/`rejected`
   * **and** move the owning run `→ superseded`, in a single transaction. A
   * failure rolls back both. Returns the affected run id, or null when there
   * was no still-pending plan under `planId`.
   */
  resolvePlan(
    planId: string,
    resolution: PlanResolution,
  ): Promise<{ runId: string } | null>
}

export interface RunState {
  transition(runId: string, to: RunStatus): Promise<void>
  startRun(chatId: string): Promise<string>
  isRunActive(runId: string): Promise<boolean>
  pauseForPlan(runId: string, planCall: PendingPlanCall): Promise<void>
  resolvePlan(
    planId: string,
    resolution: PlanResolution,
  ): Promise<{ runId: string } | null>
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

  async function pauseForPlan(
    runId: string,
    planCall: PendingPlanCall,
  ): Promise<void> {
    const current = await repo.loadStatus(runId)
    if (current === null) {
      throw new Error(`Cannot pause unknown run ${runId}`)
    }
    // The run already finished (a /stop or a superseding message landed while
    // the model was still emitting the plan). Inserting a pending row now would
    // orphan it against a terminal run, so stand down rather than pause.
    if (TERMINAL.has(current)) return
    if (!LEGAL_EDGES[current].has("paused_for_plan")) {
      throw new Error(`Illegal run transition: ${current} → paused_for_plan`)
    }
    await repo.pauseForPlan(runId, planCall)
  }

  async function resolvePlan(
    planId: string,
    resolution: PlanResolution,
  ): Promise<{ runId: string } | null> {
    // The pending-status and run-supersede guards live in the atomic repo
    // write itself (one transaction), so there is no read-then-write window
    // for the two tables to drift apart.
    return repo.resolvePlan(planId, resolution)
  }

  return { transition, startRun, isRunActive, pauseForPlan, resolvePlan }
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
    async pauseForPlan(runId, planCall) {
      // `batch` runs both statements inside one Postgres transaction — the only
      // atomic primitive the neon-http driver exposes (it rejects interactive
      // `transaction()`). A failure on either (e.g. the insert hitting the
      // tool-call id's primary key) rolls the whole batch back, so the run
      // status change and the pending row are all-or-nothing.
      await database.batch([
        database
          .update(agentRun)
          .set({ status: "paused_for_plan" })
          .where(eq(agentRun.id, runId)),
        database.insert(agentPendingToolCall).values({
          id: planCall.toolCallId,
          runId,
          chatId: planCall.chatId,
          toolName: planCall.toolName,
          input: planCall.input,
        }),
      ])
    },
    async resolvePlan(planId, resolution) {
      // Read the owning run first — the pending row carries it. The two writes
      // that follow are what must stay atomic; this read only decides whether
      // there's anything still pending to resolve.
      const [pending] = await database
        .select({
          runId: agentPendingToolCall.runId,
          status: agentPendingToolCall.status,
        })
        .from(agentPendingToolCall)
        .where(eq(agentPendingToolCall.id, planId))
        .limit(1)
      if (!pending || pending.status !== "pending") return null

      // Both updates in one transaction. The status guards in the WHERE clauses
      // keep this idempotent and keep it from clobbering a run a concurrent
      // /stop already aborted.
      await database.batch([
        database
          .update(agentPendingToolCall)
          .set({
            status: resolution.approved ? "approved" : "rejected",
            feedback: resolution.feedback ?? null,
            resolvedAt: new Date(),
          })
          .where(
            and(
              eq(agentPendingToolCall.id, planId),
              eq(agentPendingToolCall.status, "pending"),
            ),
          ),
        database
          .update(agentRun)
          .set({ status: "superseded", endedAt: new Date() })
          .where(
            and(
              eq(agentRun.id, pending.runId),
              inArray(agentRun.status, ["running", "paused_for_plan"]),
            ),
          ),
      ])
      return { runId: pending.runId }
    },
  }
}

// Default machine bound to the live database. The engine and the agent routes
// drive every run transition through these. The final contract slice (#170)
// retires the legacy `ended` status value and the `aborted` boolean column the
// old persistence helpers wrote.
const defaultRunState = createRunState(drizzleRepo())

export const transition = defaultRunState.transition
export const startRun = defaultRunState.startRun
export const isRunActive = defaultRunState.isRunActive
export const pauseForPlan = defaultRunState.pauseForPlan
export const resolvePlan = defaultRunState.resolvePlan
