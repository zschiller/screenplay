# Design note — Agent run lifecycle as an explicit state machine

Status: **proposed** (not yet implemented). Captured from an architecture
review + design grilling session. Pick up from here.

See `CONTEXT.md` for domain terms. Relevant code: `lib/db/schema.ts`
(`agentRun`, `agentPendingToolCall`), `lib/agent/persistence.ts` (transitions),
`lib/agent/engine.ts`, `app/api/agent/{stream,stop,plan}/route.ts`.

> Related to the agent-tools note (#2): this is the *persistence* side of the
> `submit_plan` human-in-the-loop.

---

## Problem

A run's true state is the **product of two columns** on `agentRun` — `status`
(`running | paused_for_plan | ended`) **and** a separate `aborted` boolean. So
illegal combinations are representable (`running + aborted`, a resting
`paused_for_plan + aborted`). Worse, **both fields are overloaded**, and the
schema discards distinctions the code already has in hand at the transition:

| What actually happened | Recorded today |
|---|---|
| Loop finished cleanly (`engine.ts:146`) | `ended` |
| Loop errored (`engine.ts:168`, catch block *holding the error*) | `ended` |
| User clicked Stop (`abortRun`) | `ended` + `aborted=true` |
| User **approved a plan** → `plan/route.ts:89` calls `startRun`, whose cleanup aborts the paused run | `ended` + `aborted=true` |

- `aborted` does **not** mean "user stopped" — it's set both by `abortRun`
  (`/stop`) and by `startRun`'s "supersede any active run before inserting a new
  one" cleanup. Since **resume-after-plan is implemented as `startRun`**, an
  **approved** plan's run is marked identically to a **cancelled** one.
- `ended` conflates *completed*, *failed*, and *aborted*.

Transitions are ~6 scattered raw `db.update().set(...)` calls across
`persistence.ts`, two routes, and the engine, with no guard — e.g. the error
path calls `endRun("ended")` on a run `/stop` has already ended.

Separately, a paused run and its plan live in **two tables** that must agree:
`agentRun.status = "paused_for_plan"` ⟺ an `agentPendingToolCall` with
`status = "pending"` exists. Today two independent calls keep them in sync by
hand (engine: `endRun(paused)` + `savePendingToolCall`; plan route:
`resolvePendingToolCall` + `startRun`). A crash between the two writes leaves a
paused run with no plan, or a pending plan with no paused run.

## Decisions settled in the grilling session

1. **One status enum that tells the truth** (Q1 → preserve distinctions):

   ```
   running | paused_for_plan | completed | failed | aborted | superseded
   ```

   The `aborted` boolean is **folded into the enum** — one column, illegal
   combos become unrepresentable. The new states record *why* a run stopped,
   which the code already knows at each transition point:
   - `completed` — loop finished normally
   - `failed` — loop threw (the catch block has the error)
   - `aborted` — user `/stop`, with no continuation
   - `superseded` — replaced by a subsequent run (plan approved/rejected, or a
     new message arrived while running/paused)

2. **One guarded transition.** A single `lib/agent/run-state.ts` defines the
   legal edges and a `transition(runId, to)` that rejects illegal ones and sets
   `endedAt` on terminal states. Every status change goes through it; the
   scattered `set(...)` calls are deleted.

   Legal edges:
   ```
   running         → completed | failed | aborted | superseded | paused_for_plan
   paused_for_plan → aborted | superseded
   (terminal: completed, failed, aborted, superseded — no outgoing edges)
   ```
   Terminal-state guards fix latent bugs for free: a late `/stop` on a finished
   run is a rejected (no-op) transition, not a clobber; the error path can't
   re-end an already-aborted run.

3. **The machine owns the run ↔ pending-plan coupling** (Q2 → own both). The
   two-table invariant is maintained by transition operations that write **both
   tables in one DB transaction**, so they cannot drift:
   - `pauseForPlan(runId, planCall)` — `running → paused_for_plan` **and** insert
     the `pending` tool-call row, atomically.
   - `resolvePlan(planId, { approved, feedback })` — set the tool-call
     `approved`/`rejected` **and** move its run `→ superseded`, atomically.
     (Starting the *new* run is a separate `startRun`; it isn't part of the
     invariant, so it's fine for it to fail independently.)
   The pending-tool-call row itself stays its own table — it carries data the run
   status can't (the verbatim AI-SDK tool-call id used for broadcast + history
   reconstruction, the plan input, feedback). The machine *coordinates* it, it
   doesn't absorb it.

4. **The between-steps check generalizes.** The loop's `isRunAborted` poll
   (`engine.ts:71`) becomes "is my run still `running`?" so it halts on both
   `aborted` (user stop) and `superseded` (replaced mid-flight), which today only
   works because `startRun` happens to flip the same `aborted` boolean.

5. **The engine reports the real outcome.** Because the terminal status now
   distinguishes cases, the catch block can transition to `failed` vs. read the
   already-set `aborted` and broadcast the correct message (instead of always
   "Stopped by user").

## Shape sketch

```ts
// lib/agent/run-state.ts
export type RunStatus =
  | "running" | "paused_for_plan"
  | "completed" | "failed" | "aborted" | "superseded"

const LEGAL: Record<RunStatus, RunStatus[]> = { /* edges above */ }

transition(runId, to): Promise<void>            // guarded; sets endedAt on terminals
startRun(chatId): Promise<string>                // supersedes active runs, inserts running
pauseForPlan(runId, planCall): Promise<string>   // run + pending row, one tx
resolvePlan(planId, resolution): Promise<void>   // tool-call + run → superseded, one tx
isRunActive(runId): Promise<boolean>             // status === "running" (loop poll)
```

## Tests

- each legal transition succeeds; each illegal one (e.g. `completed → running`,
  `aborted → completed`) is rejected;
- `pauseForPlan` / `resolvePlan` leave the two tables consistent — and a thrown
  error inside either leaves *neither* written (transaction rolls back);
- a `/stop` arriving after a run completed is a no-op, not a clobber;
- the four outcomes (`completed` / `failed` / `aborted` / `superseded`) are each
  reachable and recorded distinctly.

## Migration

- Drizzle migration: widen the `status` text enum to the six values; **drop the
  `aborted` column**. Backfill historical rows best-effort: `aborted=true →
  aborted`, `status=ended (not aborted) → completed` (errors aren't
  distinguishable in old data — acceptable loss for history).
- Introduce `run-state.ts`; replace `startRun`/`abortRun`/`endRun`/`isRunAborted`
  call sites in `engine.ts` + the three routes with the new operations.
