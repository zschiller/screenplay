import "server-only"

import { after } from "next/server"
import { buildAgentSystemPrompt } from "./config"
import { getMergedSkillIndexForSandbox } from "@/lib/skills/sandbox-index"
import { toolsetFor } from "./toolset"
import type { ToolContext } from "./tools"
import type { RoomDoc } from "@/lib/room-access"
import {
  agentChatTarget,
  loadCanvasMemory,
  loadLayerDirectory,
  markdownLayerChatTarget,
  liveRoomToolPorts,
  prepareChatTarget,
  roomChatTarget,
} from "./chat-target-kinds"
import { ensureRoomChat } from "@/lib/room-chat"
import type { RoomAccess } from "@/lib/room-access"
import { DEFAULT_MODEL } from "./providers"
import {
  appendAcpMessage,
  findActiveRun,
  findPendingPlanForChat,
  getChatModel,
  loadAcpHistory,
  upsertAcpToolCall,
  upsertChat,
} from "./persistence"
import { resolvePlan, runStatus, startRun, transition } from "./run-state"
import {
  broadcastAcpUpdate,
  broadcastControl,
  broadcastSignal,
} from "./broadcast"
import { getGitHubTokenForUser } from "@/lib/auth-helpers"
import { renameAgentBranch } from "@/lib/sandbox/git"
import {
  applyNames,
  renameClaimedBranch,
  type BranchRenameClaim,
} from "./auto-naming"
import { resolveLiveEngine } from "./acp/resolve-live-engine"
import { wireToContentBlocks } from "./acp/markers"
import { launchEngineTurn } from "./launch-turn"
import { deduplicateBranchName, generateChatNames } from "./naming"
import {
  queueCommentRequest,
  settleCommentRequest,
  startCommentRequest,
} from "./comment-request"
import {
  launchTurn,
  stopTurn,
  type TurnLaunchDeps,
  type TurnStopDeps,
  type TurnTarget,
} from "./turn-launch"
import { prependTurnMarkers } from "./message-markers"
import {
  createWorkspaces,
  wakeRequesterId,
  type WorkspacePlanInput,
  type WorkspaceTurnRequest,
} from "./room-tools"
import {
  CREATE_WORKSPACES_TOOL,
  workspacePlanRejectedResult,
} from "./workspace-task"
import type { AcpToolCallRecord } from "./acp/record"
import { textBlock, toolCallStart } from "./acp/schema"
import { toolKindFor } from "./acp/adapter"
import type { RoomTarget } from "./chat-target-kinds"
import { startBranchProvisioning } from "@/lib/branch/provisioning-live"
import { isLocalBuild } from "@/lib/local-mode"
import {
  createKeyedQueue,
  wakeMessage,
  type WorkspaceTurnEnd,
} from "./coordinator-wake"
import { loadChatTranscript } from "./history-load"
import { renderLastTurn } from "./room-read-tools"
import { roomChatId } from "@/lib/chat/room-chat"
import { workspaceLabel } from "@/lib/workspace-label"

/**
 * Turn Launch over the live database, Room broadcast and `after()`, for a turn
 * in `room` (the route's Room Access). The comment hooks write the room's
 * doorbell through it; their `roomId` is the same Room.
 */
export const liveTurnLaunchDeps = (room: RoomAccess): TurnLaunchDeps => ({
  resolveEngine: resolveLiveEngine,
  findPendingPlan: findPendingPlanForChat,
  resolvePlan,
  // The user turn is stored ACP-native: the decorated wire text (plan/branch
  // markers + `@`-mention `resource_link`s) encoded to content blocks.
  persistUserTurn: (chatId, userText) =>
    appendAcpMessage(chatId, {
      role: "user",
      content: wireToContentBlocks(userText),
    }),
  startRun,
  broadcastStreamStart: (roomId, chatId) =>
    broadcastSignal(roomId, chatId, "chat-stream-start"),
  broadcastUpdate: broadcastAcpUpdate,
  broadcastControl,
  renameBranch: (claim) =>
    renameClaimedBranch(
      {
        room,
        async renameGitBranch({ repo, sandboxName, from, to, userId }) {
          const token = await getGitHubTokenForUser(userId)
          const result = await renameAgentBranch(
            repo,
            sandboxName,
            from,
            to,
            token ?? undefined
          )
          return result.success
        },
      },
      claim
    ),
  queueCommentRequest: (input) => queueCommentRequest({ ...input, room }),
  startCommentRequest: (_roomId, chatId) => startCommentRequest(room, chatId),
  settleCommentRequest: (input) => settleCommentRequest({ ...input, room }),
  driveTurn: launchEngineTurn,
  loadRunStatus: runStatus,
  wakeCoordinator: (end) =>
    wakeCoordinator(room, end).catch((e) => {
      console.error("coordinator wake failed:", e)
    }),
  runAfterResponse: (task) => after(task),
})

/** Coordinator wakes, one at a time per Room, in the order turns ended. */
const wakeQueue = createKeyedQueue()

/** How often a wake checks whether the Coordinator is still answering. */
const COORDINATOR_IDLE_POLL_MS = 1_000
/**
 * The longest a wake waits for the Coordinator's current turn before it runs
 * anyway, so a run record a crash left `running` can't hold wakes forever.
 */
const COORDINATOR_IDLE_WAIT_MS = 5 * 60_000

/**
 * Tell the Room's Coordinator how a Workspace turn ended (#897): which
 * Workspace, the run state, and the turn's summary and final reply, read now
 * so a queued wake still reports its own turn. Chats that aren't on a
 * Workspace wake nothing.
 */
async function wakeCoordinator(
  room: RoomAccess,
  end: WorkspaceTurnEnd
): Promise<void> {
  const workspace = await room.readDoc(({ chatSessions, branches }) => {
    const branchId = chatSessions.get(end.chatId)?.branchId
    const branch = branchId ? branches.get(branchId) : undefined
    return branch
      ? {
          id: branch.id,
          title: workspaceLabel(branch),
          // Workspaces this wake creates belong to this Workspace's owner.
          requesterId: wakeRequesterId(branch, room.userId),
        }
      : null
  })
  if (!workspace) return
  const message = wakeMessage({
    workspaceId: workspace.id,
    title: workspace.title,
    status: end.status,
    lastTurn: renderLastTurn(await loadChatTranscript(end.chatId)),
  })
  await wakeQueue(room.roomId, () =>
    runWakeTurn(room, message, workspace.requesterId)
  )
}

/**
 * One Coordinator turn for a wake, through the same Turn Launch a typed
 * message takes, held until the turn is over so the next wake starts after it.
 * It waits for a turn the user started to finish first: a new turn would
 * supersede it.
 */
async function runWakeTurn(
  room: RoomAccess,
  message: string,
  requesterId: string
): Promise<void> {
  const chatId = roomChatId(room.roomId)
  const deadline = Date.now() + COORDINATOR_IDLE_WAIT_MS
  while ((await findActiveRun(chatId)) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, COORDINATOR_IDLE_POLL_MS))
  }
  const model = (await getChatModel(chatId)) ?? undefined
  let drive: (() => Promise<void>) | undefined
  await launchTurn(
    {
      ...liveTurnLaunchDeps(room),
      runAfterResponse: (task) => {
        drive = task
      },
    },
    { roomId: room.roomId, chatId, message, model },
    roomTurn({ room, chatId, message, model, requesterId })
  )
  await drive?.()
}

/** Stopping a turn over the live database and Room broadcast. */
export const liveTurnStopDeps: TurnStopDeps = {
  findActiveRun,
  transition,
  broadcastControl,
  broadcastStreamEnd: (roomId, chatId) =>
    broadcastSignal(roomId, chatId, "chat-stream-end"),
}

/**
 * A chat on a Markdown Layer: no sandbox, and its kind-specific bits (system
 * prompt, tools, message decoration) come from the layer's `ChatTargetSpec`.
 */
export function markdownLayerTurn(input: {
  room: RoomDoc
  chatId: string
  markdownLayerId: string
  message: string
  model?: string
}): TurnTarget {
  return {
    async prepare() {
      const prepared = await prepareChatTarget(
        input.room,
        // Cast through `never` so prepareChatTarget's generic doesn't try to
        // unify the spec with its target.
        markdownLayerChatTarget as unknown as Parameters<
          typeof prepareChatTarget
        >[1],
        { markdownLayerId: input.markdownLayerId } as unknown as never
      )
      if (!prepared) return null

      const model = input.model || DEFAULT_MODEL
      await upsertChat({
        chatId: input.chatId,
        roomId: input.room.roomId,
        // No sandbox: an empty string satisfies the NOT NULL constraint; it's
        // never read back for layer chats.
        sandboxName: "",
        model,
        systemPrompt: prepared.systemPrompt,
      })

      // Plan mode is a sandbox-chat feature and stops at this boundary (#743).
      // The spec's decorator drops the marker and no `planMode` reaches the
      // engine: on the ACP engine a plan-mode turn turns the permission handler
      // into the ExitPlanMode gate, which would refuse this target's document
      // writes. A chat carrying a stale `planMode: true` must still run normally.
      return {
        systemPrompt: prepared.systemPrompt,
        model,
        tools: prepared.tools,
        userText: prepared.decorateUserMessage(input.message, {
          isFirstMessage: false,
        }),
      }
    },
  }
}

/**
 * The Room's Room Target chat (the Coordinator): no sandbox, the whole canvas
 * as context, and the Coordinator tools module as its toolset. The chat record
 * is created here too when no client has created it yet.
 */
export function roomTurn(input: {
  room: RoomAccess
  chatId: string
  message: string
  model?: string
  /** Who owns Workspaces this turn creates, when not the acting member. */
  requesterId?: string
}): TurnTarget {
  const { room, chatId } = input
  return {
    async prepare() {
      await ensureRoomChat(room)
      const prepared = await prepareChatTarget(
        room,
        roomChatTarget as unknown as Parameters<typeof prepareChatTarget>[1],
        coordinatorTarget(room, chatId, {
          requesterId: input.requesterId,
        }) as unknown as never
      )
      if (!prepared) return null

      const model = input.model || DEFAULT_MODEL
      await upsertChat({
        chatId,
        roomId: room.roomId,
        // No sandbox, as for a document chat.
        sandboxName: "",
        model,
        systemPrompt: prepared.systemPrompt,
      })
      return {
        systemPrompt: prepared.systemPrompt,
        model,
        tools: prepared.tools,
        userText: prepared.decorateUserMessage(input.message, {
          isFirstMessage: false,
        }),
      }
    },
  }
}

/**
 * The Coordinator's live Room Target for a turn in `coordinatorChatId`: what
 * its tools drive (Delegated Messages, Workspace provisioning, stopping a
 * Workspace turn), acting as the member whose message the turn answers.
 */
export function coordinatorTarget(
  room: RoomAccess,
  coordinatorChatId: string,
  opts: { turnId?: string; requesterId?: string } = {}
): RoomTarget {
  return {
    userId: room.userId,
    turnId: opts.turnId,
    requesterId: opts.requesterId,
    coordinatorChatId,
    launchWorkspaceTurn: delegatedTurnLauncher(room, coordinatorChatId),
    // Provisioned with the owner's GitHub account, as the create they asked
    // for; the seed message follows once the sandbox runs.
    async provisionWorkspace(request) {
      const owner = await room.readDoc(
        ({ branches }) => branches.get(request.branchId)?.createdBy
      )
      const ghToken =
        (await getGitHubTokenForUser(owner ?? room.userId)) ?? undefined
      if (!ghToken && !isLocalBuild) {
        throw new Error("no GitHub token; the owner needs to sign in again")
      }
      await startBranchProvisioning(room, request, {
        ghToken,
        runAfter: after,
        onRunning: (id) => sendPendingSeed(room, id),
      })
    },
    stopWorkspaceTurn: (chatId) =>
      stopTurn(liveTurnStopDeps, { roomId: room.roomId, chatId }),
  }
}

/**
 * Settle a `create_workspaces` plan the user just decided (#898), once its
 * resume turn has started: on approval create the Workspaces, then record the
 * call with its outcome in the Coordinator chat, where it shows as task rows,
 * ahead of the resumed turn reading it. A rejection records the call as not
 * created, so the Coordinator sees what it proposed beside the feedback.
 */
export async function settleWorkspacePlan(
  room: RoomAccess,
  input: {
    chatId: string
    runId: string
    planId: string
    plan: WorkspacePlanInput
    approved: boolean
    feedback?: string
  }
): Promise<void> {
  const { chatId, runId, planId, plan, approved, feedback } = input
  const text = approved
    ? await createWorkspaces(
        liveRoomToolPorts(room, coordinatorTarget(room, chatId)),
        plan
      )
    : workspacePlanRejectedResult(feedback)
  const call = {
    toolCallId: planId,
    title: CREATE_WORKSPACES_TOOL,
    kind: toolKindFor(CREATE_WORKSPACES_TOOL),
    status: approved ? ("completed" as const) : ("failed" as const),
    rawInput: { workspaces: plan.workspaces },
    content: [{ type: "content" as const, content: textBlock(text) }],
  }
  const record: AcpToolCallRecord = { role: "tool_call", ...call }
  await upsertAcpToolCall(chatId, runId, record)
  await broadcastAcpUpdate(room.roomId, chatId, toolCallStart(call))
}

/**
 * Send a Workspace's pending seed message (#898) once its sandbox runs: the
 * first turn of a Workspace the Coordinator created, as a Delegated Message
 * from that Coordinator chat, acting as the Workspace's owner. The seed is
 * claimed before it's sent, so a second call (a Retry racing a reload) sends
 * nothing.
 */
export async function sendPendingSeed(
  room: RoomAccess,
  branchId: string
): Promise<void> {
  const claimed = await room.mutateDoc(({ branches }) => {
    const branch = branches.get(branchId)
    if (!branch?.pendingSeed || branch.status !== "running") return null
    branches.update(branchId, { pendingSeed: undefined })
    return { branch, seed: branch.pendingSeed }
  })
  if (!claimed) return
  const { branch, seed } = claimed
  const owner = branch.createdBy ? { ...room, userId: branch.createdBy } : room
  await launchDelegatedTurn(owner, seed.coordinatorChatId, {
    branchId,
    sandboxName: branch.sandboxName,
    chatId: seed.chatId,
    message: seed.message,
    isFirstChat: true,
  }).catch((e) =>
    console.error(`[coordinator] seed for Workspace ${branchId} failed`, e)
  )
}

/**
 * A Delegated Message (#896): the Coordinator chat `coordinatorChatId` starts a
 * turn in a Workspace chat, through the same Turn Launch a typed message takes.
 * The turn is the acting member's, as if they had typed it; its user message
 * carries the `[from coordinator: …]` prefix, in the live echo too, so the
 * Workspace chat shows it collapsed. Resolves once the turn is started.
 */
export function delegatedTurnLauncher(
  room: RoomAccess,
  coordinatorChatId: string
): (request: WorkspaceTurnRequest) => Promise<void> {
  return (request) => launchDelegatedTurn(room, coordinatorChatId, request)
}

async function launchDelegatedTurn(
  room: RoomAccess,
  coordinatorChatId: string,
  request: WorkspaceTurnRequest
): Promise<void> {
  const { chatId, sandboxName, message, model } = request
  const result = await launchTurn(
    liveTurnLaunchDeps(room),
    {
      roomId: room.roomId,
      chatId,
      message: prependTurnMarkers(message, {
        delegatedFrom: coordinatorChatId,
      }),
      sandboxName,
      model,
    },
    sandboxTurn({
      room,
      chatId,
      sandboxName,
      userId: room.userId,
      message,
      isFirstChat: request.isFirstChat,
      model,
      delegatedFrom: coordinatorChatId,
    })
  )
  if (result.kind === "target-not-found") {
    throw new Error("The Workspace is gone.")
  }
  if (result.kind === "plan-already-resolved") {
    throw new Error("The Workspace's plan changed while sending. Try again.")
  }
}

/** A chat on a Branch's sandbox. */
export function sandboxTurn(input: {
  room: RoomDoc
  chatId: string
  sandboxName: string
  userId: string
  message: string
  isFirstChat?: boolean
  planMode?: boolean
  model?: string
  commentThreadIds?: string[]
  /** The sending Coordinator chat, when this turn is a Delegated Message. */
  delegatedFrom?: string
}): TurnTarget {
  const { room, chatId, sandboxName, userId, message, planMode } = input
  const { roomId } = room
  return {
    async prepare() {
      // A chat is "new" if it has no prior ACP-native records. More reliable
      // than the client-supplied `isFirstChat`.
      const isNewChat = (await loadAcpHistory(chatId)).length === 0
      const model = input.model || DEFAULT_MODEL
      const toolCtx: ToolContext = { sandboxName, room, userId }

      // Repo-scoped optional system prompt + the merged App∪Repo Skill index,
      // enumerated from this Branch's sandbox (`.claude/skills/`) and baked into
      // the per-Agent prompt.
      const [branchState, layerDirectory, skills, memory] = await Promise.all([
        room
          .readDoc(({ branches, repos }) => {
            // `toArray` is a cached snapshot; read the Branch itself fresh.
            const id = branches
              .toArray()
              .find((a) => a.sandboxName === sandboxName)?.id
            const branch = id ? branches.get(id) : undefined
            if (!branch) return undefined
            return {
              ref: branch.ref,
              autoNamed: branch.autoNamedBranch !== false,
              systemPrompt: repos.get(branch.repoId)?.systemPrompt,
            }
          })
          .catch(() => undefined),
        loadLayerDirectory(room),
        getMergedSkillIndexForSandbox(sandboxName),
        loadCanvasMemory(room),
      ])
      const systemPrompt = buildAgentSystemPrompt({
        repoSystemPrompt: branchState?.systemPrompt ?? undefined,
        layerDirectory,
        skills,
        memory,
      })

      await upsertChat({ chatId, roomId, sandboxName, model, systemPrompt })

      // First-message naming (#910). Every new chat earns a label; the Branch
      // rename is narrower: only the first chat on the Branch, and only while
      // the room doc says it is still auto-named, so a later chat can't rename
      // it under its siblings. The names go straight into the room doc here;
      // clients observe it. The git rename runs before the Engine does.
      let effectiveBranch = branchState?.ref
      let branchRename: BranchRenameClaim | undefined
      if (isNewChat) {
        const shouldNameBranch =
          branchState?.autoNamed !== false && input.isFirstChat !== false
        const {
          branch: rawBranch,
          chatLabel,
          title,
        } = await generateChatNames({
          message,
          shouldNameBranch,
          model,
        })
        const branch =
          shouldNameBranch && rawBranch
            ? await deduplicateBranchName(room, rawBranch, userId)
            : undefined
        const claim = await applyNames(room, {
          chatId,
          sandboxName,
          userId,
          label: chatLabel || undefined,
          branch,
          // The Workspace takes its title from the same call (#881).
          title: shouldNameBranch ? title || undefined : undefined,
        })
        if (claim) {
          branchRename = claim
          effectiveBranch = claim.to
        }
      }

      return {
        systemPrompt,
        model,
        tools: toolsetFor({ kind: "sandbox", room, sandbox: toolCtx }),
        // The Chat Target spec owns the marker policy (branch only on the
        // first message) and delegates the format to the Message Markers codec.
        userText: agentChatTarget.decorateUserMessage!(message, {
          planMode,
          branch: effectiveBranch,
          isFirstMessage: isNewChat,
          delegatedFrom: input.delegatedFrom,
        }),
        planMode,
        branchRename,
        commentRequest: {
          sandboxName,
          userId,
          threadIds: Array.isArray(input.commentThreadIds)
            ? input.commentThreadIds.filter((id) => typeof id === "string")
            : [],
        },
        wakesCoordinator: true,
      }
    },
  }
}

/**
 * A chat resuming from a plan decision. It reuses the chat's recorded config
 * (the original run's prompt, model and sandbox); the message is the decision's
 * continuation text, and the turn settles any comment request the plan paused.
 */
export function planResumeTurn(input: {
  room: RoomDoc
  userId: string
  message: string
  chat: { sandboxName: string; model: string; systemPrompt: string }
}): TurnTarget {
  const { room, userId, message, chat } = input
  return {
    async prepare() {
      const toolCtx: ToolContext = {
        sandboxName: chat.sandboxName,
        room,
        userId,
      }
      return {
        systemPrompt: chat.systemPrompt,
        model: chat.model,
        tools: toolsetFor({ kind: "sandbox", room, sandbox: toolCtx }),
        userText: message,
        commentRequest: {
          sandboxName: chat.sandboxName,
          userId,
          threadIds: [],
        },
        wakesCoordinator: true,
      }
    },
  }
}
