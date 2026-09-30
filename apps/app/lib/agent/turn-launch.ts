import type { Tool } from "ai"
import type { Engine } from "./acp/engine-seam"
import type { SessionUpdate } from "./acp/schema"
import type { ChatControlEvent } from "@/lib/chat-store"
import type { PlanResolution, RunStatus } from "./run-state"
import { isWakeStatus, type WorkspaceTurnEnd } from "./coordinator-wake"
import type { BranchRenameClaim } from "./auto-naming"
import type { SteerInbox } from "./steer-inbox"
import { projectUserTurn, userTurnEcho } from "./user-turn"

/**
 * What a Chat Target hands {@link launchTurn} once its kind-specific setup is
 * done: the prompt, model and Tools the Engine runs with, the decorated user
 * text to persist, the Branch rename it claimed, and the comment request.
 */
export interface PreparedTurn {
  systemPrompt: string
  model: string
  tools: Record<string, Tool>
  /** The user message as persisted: plan/branch markers already applied. */
  userText: string
  /** Whether the turn was sent in plan mode (sandbox chats only). */
  planMode?: boolean
  /**
   * A first-message Branch rename the target already wrote to the room doc
   * (#910). Turn Launch renames the git branch before the Engine runs, so the
   * agent works on the branch its first message names.
   */
  branchRename?: BranchRenameClaim
  /**
   * Comment threads (#788). Present on every sandbox turn: the turn queues
   * `threadIds` (possibly none), and starts and settles whatever the chat
   * still owes, including threads from an earlier plan-paused turn.
   */
  commentRequest?: {
    sandboxName: string
    userId: string
    threadIds: string[]
  }
  /**
   * A Workspace turn (#897): once it ends, however it ends, the Room's
   * Coordinator hears how. Set on every sandbox turn, whoever sent it.
   */
  wakesCoordinator?: boolean
}

/**
 * One Chat Target kind's setup for a turn. `prepare` runs after the Engine is
 * resolved and may write (upsert the chat, name it); `null` means the target no
 * longer exists.
 */
export interface TurnTarget {
  prepare(): Promise<PreparedTurn | null>
  /**
   * The same target for a later message: the turn Steers left over from this
   * one start (#1190), with the chat's current model and plan mode. Without
   * it, leftovers go back to their sender instead.
   */
  followUp?(message: string): TurnTarget
}

export interface TurnRequest {
  roomId: string
  chatId: string
  /** The user's message as typed; the target decorates it into the turn. */
  message: string
  sandboxName?: string
  /** The document a document chat's turn targets. */
  markdownLayerId?: string
  model?: string
  /** Who sent the message, recorded on a Steer so a stop can hand it back. */
  userId?: string | null
  /**
   * The human's decision on a paused plan, when this turn resumes from one
   * (the plan route). Without it, a plan still pending on the chat is
   * implicitly rejected, with this message as the feedback.
   */
  planDecision?: PlanDecision
  /**
   * Retry of the chat's failed turn (#1228). Its ask is already the last user
   * message in the transcript, so the new turn runs on it rather than storing
   * and echoing it again. Honoured only while the chat's latest run failed.
   */
  retry?: boolean
}

export interface PlanDecision extends PlanResolution {
  planId: string
}

/** The Engine turn Turn Launch hands off once the response has gone out. */
export interface EngineTurnLaunch {
  engine: Engine
  roomId: string
  chatId: string
  runId: string
  systemPrompt: string
  model: string
  tools: Record<string, Tool>
  planMode?: boolean
  /**
   * The turn answers a Coordinator wake (#897): a stock no-reply line it
   * writes is dropped rather than shown (#1224).
   */
  wake?: boolean
  /**
   * Where the Engine reports, once its session is open, whether this run takes
   * Steers (#1250). Turn Launch records the first answer on the run and tells
   * clients; later reports change nothing.
   */
  reportSteering(steers: boolean): Promise<void>
}

/**
 * The side effects Turn Launch orders. Injected so the keystone test drives the
 * real sequence over in-memory run-state, persistence and broadcast.
 */
export interface TurnLaunchDeps {
  resolveEngine(input: {
    sandboxName?: string
    markdownLayerId?: string
    chatId: string
    model?: string
    roomId: string
  }): Promise<Engine>
  /** The chat's most recent plan still awaiting a decision, if any. */
  findPendingPlan(chatId: string): Promise<{ id: string } | null>
  /**
   * Mark a pending plan approved/rejected and supersede its paused run,
   * atomically. Null when the plan was no longer pending.
   */
  resolvePlan(
    planId: string,
    resolution: PlanResolution
  ): Promise<{ runId: string } | null>
  persistUserTurn(chatId: string, userText: string): Promise<void>
  startRun(chatId: string): Promise<string>
  broadcastStreamStart(roomId: string, chatId: string): Promise<void>
  broadcastUpdate(
    roomId: string,
    chatId: string,
    update: SessionUpdate
  ): Promise<void>
  broadcastControl(
    roomId: string,
    chatId: string,
    control: ChatControlEvent
  ): Promise<void>
  /** Rename the claimed git branch; roll the doc back if git refuses. */
  renameBranch(claim: BranchRenameClaim): Promise<void>
  queueCommentRequest(input: {
    roomId: string
    chatId: string
    sandboxName: string
    threadIds: string[]
  }): Promise<void>
  startCommentRequest(roomId: string, chatId: string): Promise<void>
  settleCommentRequest(input: {
    roomId: string
    chatId: string
    runId: string
    sandboxName: string
    userId: string
  }): Promise<void>
  /** Drive the Engine turn (the abort watchdog and consumer live behind this). */
  driveTurn(turn: EngineTurnLaunch): Promise<void>
  /** The run's recorded status once the Engine turn is over. */
  loadRunStatus(runId: string): Promise<RunStatus | null>
  /** Start a Coordinator turn about a Workspace turn that just ended (#897). */
  wakeCoordinator(end: WorkspaceTurnEnd): Promise<void>
  /** Schedule work to run after the HTTP response (`after()` in production). */
  runAfterResponse(task: () => Promise<void>): void
  /**
   * The chat's run that hasn't finished, if any, with whether it takes Steers
   * (null until its Engine has said).
   */
  findActiveRun(chatId: string): Promise<{
    id: string
    status: "running" | "paused_for_plan"
    steers: boolean | null
  } | null>
  /** Record on the run whether it takes Steers; the first answer stands. */
  recordSteering(runId: string, steers: boolean): Promise<void>
  /** Whether a run is still `running`. */
  isRunActive(runId: string): Promise<boolean>
  /** The status of the chat's most recent run, if it has one. */
  latestRunStatus(chatId: string): Promise<RunStatus | null>
  /** The Steer inbox (#1190). */
  steers: Pick<SteerInbox, "add" | "drain" | "reclaim">
}

export type TurnLaunchResult =
  | { kind: "started"; runId: string }
  /** The chat's run was working; the message joined it as a pending Steer. */
  | { kind: "steered"; steerId: string }
  /**
   * The chat's run was working and doesn't take Steers, or hasn't said yet
   * whether it does. The sender queues the message.
   */
  | { kind: "not-steerable" }
  | { kind: "target-not-found" }
  /** The plan decision arrived after the plan was already resolved. */
  | { kind: "plan-already-resolved" }

/**
 * Start one agent turn for a Chat Target. This is the only place the ordering
 * rules live:
 *
 * 1. Resolve the Engine before any side effect, so a misconfigured deployment
 *    fails loud at the boundary instead of after writes (ADR 0006).
 * 2. Never supersede a running run by sending (#1190). While the chat's run
 *    is `running`, the message becomes a pending Steer on it when the run
 *    takes Steers, and is refused as "not steerable" when it doesn't or its
 *    Engine hasn't said yet (#1250), so the sender queues it. Nothing else
 *    happens for a Steer: the Engine settles it into the transcript when it
 *    takes it.
 * 3. Let the target prepare (its own writes).
 * 4. Resolve the chat's plan, the one way a plan is ever resolved: the human's
 *    explicit decision when resuming, otherwise an implicit rejection of any
 *    plan still pending (the message is the revision instruction). A decision
 *    on a plan that is no longer pending stops here.
 * 5. Persist the user message before starting the run. A retry of a failed
 *    turn persists and echoes nothing: its ask is already the chat's last.
 * 6. Broadcast `chat-stream-start` before the plan card flip and the user
 *    echo. Clients replay back to the latest start marker and the event log
 *    is trimmed on each start, so anything emitted earlier is lost to a
 *    client joining mid-stream.
 * 7. After the response, rename the claimed git branch, then drive the Engine
 *    turn, with the comment request started before it and settled after it.
 *    Whether the run takes Steers is known only once the Engine's session is
 *    open: its first report is recorded on the run, then broadcast.
 * 8. Steers the run never took don't wait: when it completed, failed or
 *    paused for a plan, they start the next turn at once, joined oldest first
 *    into one message; when it was stopped, they go back to their sender.
 * 9. Once a Workspace turn is over, wake the Coordinator with how it ended:
 *    completed, failed, stopped, or paused for plan approval. Whichever
 *    Engine ran it, this is where every turn ends. A superseded run wakes
 *    nothing: the turn that superseded it will.
 *
 * Names are never broadcast: the target writes them to the room doc, and
 * clients observe the doc (#910).
 */
export async function launchTurn(
  deps: TurnLaunchDeps,
  request: TurnRequest,
  target: TurnTarget
): Promise<TurnLaunchResult> {
  const { roomId, chatId } = request

  const engine = await deps.resolveEngine({
    sandboxName: request.sandboxName,
    markdownLayerId: request.markdownLayerId,
    chatId,
    model: request.model,
    roomId,
  })

  // A retry that finds some other turn after the failed one sends its ask as
  // new, like any message.
  const retry =
    request.retry === true && (await deps.latestRunStatus(chatId)) === "failed"

  if (!request.planDecision && !retry) {
    const steered = await steerRunningTurn(deps, request)
    if (steered) return steered
  }

  const prepared = await target.prepare()
  if (!prepared) return { kind: "target-not-found" }

  const resolvedPlan = await resolveChatPlan(deps, request)
  if (resolvedPlan === "already-resolved") {
    return { kind: "plan-already-resolved" }
  }

  if (!retry) await deps.persistUserTurn(chatId, prepared.userText)
  const runId = await deps.startRun(chatId)

  await deps.broadcastStreamStart(roomId, chatId)
  if (resolvedPlan) {
    await deps.broadcastControl(roomId, chatId, {
      kind: "plan_resolved",
      ...resolvedPlan,
    })
  }
  if (!retry) {
    await deps.broadcastUpdate(roomId, chatId, userTurnEcho(prepared.userText))
  }
  const { branchRename, commentRequest } = prepared

  // Comments sent to the agent show as queued from here on.
  if (commentRequest && commentRequest.threadIds.length > 0) {
    await deps.queueCommentRequest({
      roomId,
      chatId,
      sandboxName: commentRequest.sandboxName,
      threadIds: commentRequest.threadIds,
    })
  }

  deps.runAfterResponse(async () => {
    if (branchRename) await deps.renameBranch(branchRename)
    if (commentRequest) await deps.startCommentRequest(roomId, chatId)
    await deps.driveTurn({
      engine,
      roomId,
      chatId,
      runId,
      systemPrompt: prepared.systemPrompt,
      model: prepared.model,
      tools: prepared.tools,
      planMode: prepared.planMode,
      wake: Boolean(projectUserTurn(prepared.userText).wakeFrom),
      reportSteering: reportSteeringOnce(deps, { roomId, chatId, runId }),
    })
    if (commentRequest) {
      await deps.settleCommentRequest({
        roomId,
        chatId,
        runId,
        sandboxName: commentRequest.sandboxName,
        userId: commentRequest.userId,
      })
    }
    const status = await deps.loadRunStatus(runId)
    const next = await settleLeftoverSteers(deps, request, target, {
      runId,
      status,
    })
    if (prepared.wakesCoordinator && status && isWakeStatus(status)) {
      await deps.wakeCoordinator({ roomId, chatId, runId, status })
    }
    await next?.()
  })

  return { kind: "started", runId }
}

/**
 * Join the chat's running run as a pending Steer, when there is one (#1190).
 * Null when the chat has no running run, so the message starts a turn.
 *
 * The run can end between the lookup and the insert, after it drained its
 * leftovers. A Steer still pending once the run is over is taken back here and
 * starts the turn itself; one already drained was started by the run's own
 * leftover turn.
 */
async function steerRunningTurn(
  deps: TurnLaunchDeps,
  request: TurnRequest
): Promise<TurnLaunchResult | null> {
  const { roomId, chatId, message } = request
  const active = await deps.findActiveRun(chatId)
  if (active?.status !== "running") return null
  if (active.steers !== true) return { kind: "not-steerable" }

  const steer = await deps.steers.add({
    runId: active.id,
    chatId,
    message,
    userId: request.userId ?? null,
  })
  await deps.broadcastControl(roomId, chatId, {
    kind: "steer_pending",
    steer: { id: steer.id, message, turn: projectUserTurn(message) },
  })
  if (
    !(await deps.isRunActive(active.id)) &&
    (await deps.steers.reclaim(steer.id))
  ) {
    await deps.broadcastControl(roomId, chatId, {
      kind: "steers_taken",
      ids: [steer.id],
    })
    return null
  }
  return { kind: "steered", steerId: steer.id }
}

/**
 * The run's steering report port (#1250): the first answer is recorded on the
 * run before clients hear it, so no send is taken as a Steer on a run that
 * hasn't said yes.
 */
function reportSteeringOnce(
  deps: TurnLaunchDeps,
  run: { roomId: string; chatId: string; runId: string }
): (steers: boolean) => Promise<void> {
  let reported = false
  return async (steers) => {
    if (reported) return
    reported = true
    await deps.recordSteering(run.runId, steers)
    await deps.broadcastControl(run.roomId, run.chatId, {
      kind: "steerable",
      steerable: steers,
    })
  }
}

/** Run outcomes whose leftover Steers start the next turn right away. */
const CONTINUES_WITH_LEFTOVERS: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "failed",
  "paused_for_plan",
])

/**
 * Settle the Steers a finished run never took. After a completion, failure or
 * plan pause they start the next turn, joined oldest first into one message;
 * the returned task drives that turn, so the caller can wake the Coordinator
 * about this one first. After a stop they go back to their sender's composer.
 */
async function settleLeftoverSteers(
  deps: TurnLaunchDeps,
  request: TurnRequest,
  target: TurnTarget,
  run: { runId: string; status: RunStatus | null }
): Promise<(() => Promise<void>) | undefined> {
  const { roomId, chatId } = request
  const leftovers = await deps.steers.drain(run.runId)
  if (leftovers.length === 0) return undefined

  const followUp = target.followUp
  if (!run.status || !CONTINUES_WITH_LEFTOVERS.has(run.status) || !followUp) {
    await deps.broadcastControl(roomId, chatId, {
      kind: "steers_returned",
      steers: leftovers,
    })
    return undefined
  }

  await deps.broadcastControl(roomId, chatId, {
    kind: "steers_taken",
    ids: leftovers.map((s) => s.id),
  })
  const message = leftovers.map((s) => s.message).join("\n\n")
  let drive: (() => Promise<void>) | undefined
  await launchTurn(
    {
      ...deps,
      // Held and handed back, so the next turn runs inside this one's
      // after-response work rather than scheduling its own.
      runAfterResponse: (task) => {
        drive = task
      },
    },
    {
      roomId,
      chatId,
      message,
      sandboxName: request.sandboxName,
      model: request.model,
      userId: leftovers[0]!.userId,
    },
    followUp(message)
  )
  return drive
}

/**
 * Resolve the plan this turn answers. An explicit decision must still find its
 * plan pending; an implicit rejection only applies when one is pending (and
 * quietly yields to a decision that landed first).
 */
async function resolveChatPlan(
  deps: TurnLaunchDeps,
  request: TurnRequest
): Promise<{ planId: string; approved: boolean } | "already-resolved" | null> {
  const { planDecision } = request
  if (planDecision) {
    const { planId, ...resolution } = planDecision
    const resolved = await deps.resolvePlan(planId, resolution)
    if (!resolved) return "already-resolved"
    return { planId, approved: resolution.approved }
  }
  const pending = await deps.findPendingPlan(request.chatId)
  if (!pending) return null
  const resolved = await deps.resolvePlan(pending.id, {
    approved: false,
    feedback: request.message,
  })
  return resolved ? { planId: pending.id, approved: false } : null
}

/**
 * The run status a user stop records. It is the one outcome that means "the
 * user halted this with no continuation", distinct from the `superseded` an
 * approved or rejected plan or a new message records.
 *
 * This is the whole decision about how an unfinished run reads in the
 * transcript, live and on reload: a stopped run ends with a "Stopped" marker
 * ({@link stopTurn} broadcasts it; the history route rebuilds it from runs with
 * this status), and a superseded run leaves nothing because the next turn
 * carries on. Neither is an error, so the Engine reports both as a clean
 * cancellation and the consumer shows no error bubble.
 */
export const STOPPED_RUN_STATUS = "aborted" satisfies RunStatus

/** The side effects {@link stopTurn} orders. */
export interface TurnStopDeps {
  findActiveRun(chatId: string): Promise<{ id: string } | null>
  transition(runId: string, to: RunStatus): Promise<void>
  broadcastControl(
    roomId: string,
    chatId: string,
    control: ChatControlEvent
  ): Promise<void>
  broadcastStreamEnd(roomId: string, chatId: string): Promise<void>
}

/**
 * Stop a chat's active turn at the user's request.
 *
 * Records the stop on the run first: the abort watchdog in `driveEngineTurn`
 * polls the run and aborts the Engine once it is no longer active, and the
 * run-state machine's terminal guard keeps a duplicate stop a no-op. Then marks
 * the transcript before the stream ends, so clients show the run as stopped
 * rather than finished. The stream always ends, even with no active run, so the
 * user's stop never depends on the abort landing this tick.
 */
export async function stopTurn(
  deps: TurnStopDeps,
  request: { roomId: string; chatId: string }
): Promise<void> {
  const { roomId, chatId } = request
  const active = await deps.findActiveRun(chatId)
  if (active) {
    await deps.transition(active.id, STOPPED_RUN_STATUS)
    await deps.broadcastControl(roomId, chatId, { kind: "stopped" })
  }
  await deps.broadcastStreamEnd(roomId, chatId)
}
