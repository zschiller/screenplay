import type { Tool } from "ai"
import type { Engine } from "./acp/engine-seam"
import type { SessionUpdate } from "./acp/schema"
import { userMessageChunk } from "./acp/schema"
import type { ChatControlEvent } from "@/lib/chat-store"
import type { PlanResolution } from "./run-state"

/**
 * What a Chat Target hands {@link launchTurn} once its kind-specific setup is
 * done: the prompt, model and Tools the Engine runs with, the decorated user
 * text to persist, and the first-message renames and comment request to emit.
 */
export interface PreparedTurn {
  systemPrompt: string
  model: string
  tools: Record<string, Tool>
  /** The user message as persisted: plan/branch markers already applied. */
  userText: string
  /** Whether the turn was sent in plan mode (sandbox chats only). */
  planMode?: boolean
  /** First-message renames, broadcast inside the replay window. */
  renames?: { branch?: string; label?: string }
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
}

/**
 * One Chat Target kind's setup for a turn. `prepare` runs after the Engine is
 * resolved and may write (upsert the chat, name it); `null` means the target no
 * longer exists.
 */
export interface TurnTarget {
  prepare(): Promise<PreparedTurn | null>
}

export interface TurnRequest {
  roomId: string
  chatId: string
  /** The user's message as typed, for the live echo. */
  message: string
  sandboxName?: string
  model?: string
  /**
   * The human's decision on a paused plan, when this turn resumes from one
   * (the plan route). Without it, a plan still pending on the chat is
   * implicitly rejected, with this message as the feedback.
   */
  planDecision?: PlanDecision
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
}

/**
 * The side effects Turn Launch orders. Injected so the keystone test drives the
 * real sequence over in-memory run-state, persistence and broadcast.
 */
export interface TurnLaunchDeps {
  resolveEngine(input: {
    sandboxName?: string
    chatId: string
    model?: string
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
  /** Schedule work to run after the HTTP response (`after()` in production). */
  runAfterResponse(task: () => Promise<void>): void
}

export type TurnLaunchResult =
  | { kind: "started"; runId: string }
  | { kind: "target-not-found" }
  /** The plan decision arrived after the plan was already resolved. */
  | { kind: "plan-already-resolved" }

/**
 * Start one agent turn for a Chat Target. This is the only place the ordering
 * rules live:
 *
 * 1. Resolve the Engine before any side effect, so a misconfigured deployment
 *    fails loud at the boundary instead of after writes (ADR 0006).
 * 2. Let the target prepare (its own writes).
 * 3. Resolve the chat's plan, the one way a plan is ever resolved: the human's
 *    explicit decision when resuming, otherwise an implicit rejection of any
 *    plan still pending (the message is the revision instruction). A decision
 *    on a plan that is no longer pending stops here.
 * 4. Persist the user message before starting the run.
 * 5. Broadcast `chat-stream-start` before the plan card flip, the user echo
 *    and any rename controls. Clients replay back to the latest start marker
 *    and the event log is trimmed on each start, so anything emitted earlier
 *    is lost to a client joining mid-stream.
 * 6. After the response, drive the Engine turn, with the comment request
 *    started before it and settled after it.
 */
export async function launchTurn(
  deps: TurnLaunchDeps,
  request: TurnRequest,
  target: TurnTarget
): Promise<TurnLaunchResult> {
  const { roomId, chatId, message } = request

  const engine = await deps.resolveEngine({
    sandboxName: request.sandboxName,
    chatId,
    model: request.model,
  })

  const prepared = await target.prepare()
  if (!prepared) return { kind: "target-not-found" }

  const resolvedPlan = await resolveChatPlan(deps, request)
  if (resolvedPlan === "already-resolved") {
    return { kind: "plan-already-resolved" }
  }

  await deps.persistUserTurn(chatId, prepared.userText)
  const runId = await deps.startRun(chatId)

  await deps.broadcastStreamStart(roomId, chatId)
  if (resolvedPlan) {
    await deps.broadcastControl(roomId, chatId, {
      kind: "plan_resolved",
      ...resolvedPlan,
    })
  }
  await deps.broadcastUpdate(roomId, chatId, userMessageChunk(message))
  const { renames, commentRequest } = prepared
  if (renames?.branch) {
    await deps.broadcastControl(roomId, chatId, {
      kind: "branch_rename",
      branch: renames.branch,
    })
  }
  if (renames?.label) {
    await deps.broadcastControl(roomId, chatId, {
      kind: "chat_rename",
      label: renames.label,
    })
  }

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
  })

  return { kind: "started", runId }
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
