import "server-only"

import { after } from "next/server"
import { toolsetOn } from "./toolset"
import type { RoomDoc } from "@/lib/room-access"
import { accountFilesFor, prepareChatTarget } from "./chat-target-kinds"
import { workspaceChatTarget } from "./workspace-chat-target"
import { roomChatTarget, type RoomTarget } from "./room-chat-target"
import { sketchChatTarget } from "./sketch-chat-target"
import { ensureRoomChat } from "@/lib/room-chat"
import {
  isSketchChat,
  sketchChatSession,
  SKETCH_CHAT_LABEL,
} from "@/lib/chat/sketch-chat"
import type { RoomAccess } from "@/lib/room-access"
import { DEFAULT_MODEL } from "./providers"
import {
  appendAcpMessage,
  findActiveRun,
  findPendingPlanForChat,
  getChatModel,
  latestRunStatus,
  loadAcpHistory,
  recordRunSteering,
  upsertChat,
} from "./persistence"
import {
  isRunActive,
  resolvePlan,
  runStatus,
  startRun,
  transition,
} from "./run-state"
import { steerInbox } from "./steer-inbox"
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
import { stampWorkspaceActivity } from "./workspace-activity"
import {
  resolveLiveEngine,
  toolNamingForTurn,
  turnHarnessKey,
} from "./acp/resolve-live-engine"
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
  wakeRequesterId,
  type SketchTurnRequest,
  type WorkspaceTurnRequest,
} from "./room-tools"
import { startBranchProvisioning } from "@/lib/branch/provisioning-live"
import { claimMergedPrMove } from "@/lib/branch/next-pr"
import { moveMergedBranch } from "@/lib/branch/next-pr-live"
import { isLocalBuild } from "@/lib/local-mode"
import { createGitHubPr } from "@/lib/github-pr"
import { deleteSandboxes } from "@/lib/sandbox/lifecycle"
import {
  createKeyedQueue,
  wakeMessage,
  type WorkspaceTurnEnd,
} from "./coordinator-wake"
import { loadChatTranscript } from "./history-load"
import { renderLastTurn } from "./room-read-tools"
import { roomChatId } from "@/lib/chat/room-chat"
import { workspaceLabel } from "@/lib/workspace-label"
import { sandboxSecrets } from "@/lib/env-store"
import { canvasFiles } from "@/lib/files"
import { withAttachedImages } from "@/lib/files/attach"
import { savedFileSections } from "@/lib/files/context-folder"

/**
 * Turn Launch over the live database, Room broadcast and `after()`, for a turn
 * in `room` (the route's Room Access). The comment hooks write the room's
 * doorbell through it; their `roomId` is the same Room.
 */
export const liveTurnLaunchDeps = (room: RoomAccess): TurnLaunchDeps => ({
  // A harness reads the canvas's and the sender's saved files (#1524) on
  // disk, and the Skills its Chat Target's Skill Sources hold (#1559, #1664).
  resolveEngine: ({ skills, ...input }) =>
    resolveLiveEngine({
      ...input,
      contextSections: () => {
        const sender = { userId: room.userId, senderless: input.senderless }
        return {
          ...savedFileSections(canvasFiles(room), accountFilesFor(sender)),
          ...skills?.contextSections(),
        }
      },
    }),
  findPendingPlan: findPendingPlanForChat,
  resolvePlan,
  // The user turn is stored ACP-native: the decorated wire text (plan/branch
  // markers + `@`-mention `resource_link`s) encoded to content blocks.
  persistUserTurn: (chatId, userText, sentBy) =>
    appendAcpMessage(chatId, {
      role: "user",
      content: wireToContentBlocks(userText),
      ...(sentBy ? { sentBy } : {}),
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
  moveMergedBranch,
  queueCommentRequest: (input) => queueCommentRequest({ ...input, room }),
  startCommentRequest: (_roomId, chatId) => startCommentRequest(room, chatId),
  settleCommentRequest: (input) => settleCommentRequest({ ...input, room }),
  driveTurn: (turn) =>
    launchEngineTurn({
      ...turn,
      withAttachedImages: (blocks) =>
        withAttachedImages(canvasFiles(room), blocks).catch((e) => {
          // A store hiccup sends the turn without its images; the footer
          // still names them, so the agent can open them.
          console.error("attached images failed:", e)
          return blocks
        }),
    }),
  loadRunStatus: runStatus,
  wakeCoordinator: (end) =>
    wakeCoordinator(room, end).catch((e) => {
      console.error("coordinator wake failed:", e)
    }),
  runAfterResponse: (task) => after(task),
  findActiveRun,
  recordSteering: recordRunSteering,
  isRunActive,
  latestRunStatus,
  steers: steerInbox,
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
 * so a queued wake still reports its own turn. A Sketch Chat's turns wake it
 * too; any other chat that isn't on a Workspace wakes nothing.
 */
async function wakeCoordinator(
  room: RoomAccess,
  end: WorkspaceTurnEnd
): Promise<void> {
  const workspace = await room.readDoc(({ chatSessions, branches }) => {
    const chat = chatSessions.get(end.chatId)
    // A Sketch Chat wakes it too, named by the chat itself.
    if (isSketchChat(chat)) {
      return {
        id: chat!.id,
        title: chat!.label,
        requesterId: room.userId,
        sketch: true,
      }
    }
    const branch = chat?.branchId ? branches.get(chat.branchId) : undefined
    return branch
      ? {
          id: branch.id,
          title: workspaceLabel(branch),
          // Workspaces this wake creates belong to this Workspace's owner.
          requesterId: wakeRequesterId(branch, room.userId),
          sketch: false,
        }
      : null
  })
  if (!workspace) return
  const message = wakeMessage({
    workspaceId: workspace.id,
    title: workspace.title,
    sketch: workspace.sketch,
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
    { roomId: room.roomId, chatId, message, model, senderless: true },
    roomTurn({ room, chatId, message, model, requesterId, senderless: true })
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
  /** A wake nobody sent: no account memory (#1513). */
  senderless?: boolean
}): TurnTarget {
  const { room, chatId } = input
  const target = coordinatorTarget(room, chatId, {
    requesterId: input.requesterId,
    senderless: input.senderless,
    harnessKey: turnHarnessKey(input.model),
  })
  const skills = roomChatTarget.skills(room, target)
  return {
    skills,
    async prepare() {
      await ensureRoomChat(room)
      const prepared = await prepareChatTarget(
        room,
        roomChatTarget,
        target,
        toolNamingForTurn(input.model),
        skills
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
        skillsNote: prepared.skillsNote,
        model,
        tools: prepared.tools,
        userText: prepared.decorateUserMessage(input.message, {
          isFirstMessage: false,
        }),
      }
    },
    followUp: (message) => roomTurn({ ...input, message }),
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
  opts: {
    turnId?: string
    requesterId?: string
    senderless?: boolean
    harnessKey?: string | null
  } = {}
): RoomTarget {
  const { senderless } = opts
  return {
    userId: room.userId,
    ...(senderless ? { senderless } : {}),
    harnessKey: opts.harnessKey,
    turnId: opts.turnId,
    requesterId: opts.requesterId,
    coordinatorChatId,
    launchWorkspaceTurn: delegatedTurnLauncher(room, coordinatorChatId, {
      senderless,
    }),
    launchSketchTurn: (request) =>
      launchDelegatedSketchTurn(room, coordinatorChatId, request, {
        senderless,
      }),
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
    // As the Workspace's owner, whoever asked (#901).
    openPullRequest: ({ sandboxName, ownerId }) =>
      createGitHubPr({ userId: ownerId, room, sandboxName }),
    deleteSandbox: (sandboxName) => deleteSandboxes([sandboxName]),
  }
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
  coordinatorChatId: string,
  opts: { senderless?: boolean } = {}
): (request: WorkspaceTurnRequest) => Promise<void> {
  return (request) =>
    launchDelegatedTurn(room, coordinatorChatId, request, opts)
}

async function launchDelegatedTurn(
  room: RoomAccess,
  coordinatorChatId: string,
  request: WorkspaceTurnRequest,
  { senderless }: { senderless?: boolean } = {}
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
      ...(senderless ? { senderless } : {}),
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
      senderless,
    })
  )
  if (result.kind === "target-not-found") {
    throw new Error("The chat is gone.")
  }
  if (result.kind === "plan-already-resolved") {
    throw new Error("The chat’s plan changed while sending. Try again.")
  }
  if (result.kind === "not-steerable") {
    throw new Error("The chat is busy. Try again once its turn ends.")
  }
}

async function launchDelegatedSketchTurn(
  room: RoomAccess,
  coordinatorChatId: string,
  request: SketchTurnRequest,
  { senderless }: { senderless?: boolean } = {}
): Promise<void> {
  const { chatId, message, model } = request
  const result = await launchTurn(
    liveTurnLaunchDeps(room),
    {
      roomId: room.roomId,
      chatId,
      message: prependTurnMarkers(message, {
        delegatedFrom: coordinatorChatId,
      }),
      model,
      ...(senderless ? { senderless } : {}),
    },
    sketchTurn({
      room,
      chatId,
      message,
      model,
      delegatedFrom: coordinatorChatId,
      senderless,
    })
  )
  if (result.kind === "target-not-found") {
    throw new Error("The chat is gone.")
  }
  if (result.kind === "not-steerable") {
    throw new Error("The chat is busy. Try again once its turn ends.")
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
  /** Delegated by a wake nobody sent: no account memory (#1513). */
  senderless?: boolean
}): TurnTarget {
  const { room, chatId, sandboxName, userId, message, planMode } = input
  const { roomId } = room
  const target = {
    sandboxName,
    chatId,
    userId,
    ...(input.senderless ? { senderless: true } : {}),
    harnessKey: turnHarnessKey(input.model),
  }
  const skills = workspaceChatTarget.skills(room, target)
  return {
    skills,
    async prepare() {
      // A chat is "new" if it has no prior ACP-native records. More reliable
      // than the client-supplied `isFirstChat`.
      const isNewChat = (await loadAcpHistory(chatId)).length === 0
      const model = input.model || DEFAULT_MODEL
      const [prepared, , secrets, mergedPrMove] = await Promise.all([
        prepareChatTarget(
          room,
          workspaceChatTarget,
          target,
          toolNamingForTurn(input.model),
          skills
        ),
        // Recent activity (#885): this Workspace just saw a turn start.
        stampWorkspaceActivity(room, sandboxName, Date.now()).catch(() => {}),
        sandboxSecrets(sandboxName),
        // The first turn after the Branch's PR merged moves it onto the
        // latest code (#1701), whoever or whatever sends it.
        claimMergedPrMove(room, { sandboxName, userId }).catch(() => null),
      ])
      if (!prepared) return null
      const { systemPrompt, context } = prepared
      const branchState = context.branch

      await upsertChat({ chatId, roomId, sandboxName, model, systemPrompt })

      // First-message naming (#910). Every new chat earns a label; the Branch
      // rename is narrower: only the Branch's first chat (its one chat since
      // #1315), and only while the room doc says it is still auto-named. The names go straight into the room doc here;
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
          // A Workspace and its one chat share a name (#1315): when the
          // first message titles the Workspace, the chat takes that title too.
          label: (shouldNameBranch && title) || chatLabel || undefined,
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
        skillsNote: prepared.skillsNote,
        model,
        tools: prepared.tools,
        // The Chat Target spec owns the marker policy (branch only on the
        // first message) and delegates the format to the Message Markers codec.
        userText: prepared.decorateUserMessage(message, {
          planMode,
          branch: effectiveBranch,
          isFirstMessage: isNewChat,
          delegatedFrom: input.delegatedFrom,
        }),
        planMode,
        branchRename,
        ...(mergedPrMove ? { mergedPrMove } : {}),
        commentRequest: {
          sandboxName,
          userId,
          threadIds: Array.isArray(input.commentThreadIds)
            ? input.commentThreadIds.filter((id) => typeof id === "string")
            : [],
        },
        wakesCoordinator: true,
        secrets,
      }
    },
    // Leftover Steers go out as the chat's next message: same plan mode and
    // model, no longer the Workspace's first chat, and no comment threads.
    followUp: (next) =>
      sandboxTurn({
        ...input,
        message: next,
        isFirstChat: false,
        commentThreadIds: undefined,
        delegatedFrom: undefined,
      }),
  }
}

/**
 * A Sketch Chat (`lib/chat/sketch-chat.ts`): no repository and no sandbox, so
 * the turn runs with the Document and Mockup tools only. Its first message
 * names it, unless it was created with a name.
 */
export function sketchTurn(input: {
  room: RoomAccess
  chatId: string
  message: string
  model?: string
  /** The sending Coordinator chat, when this turn is a Delegated Message. */
  delegatedFrom?: string
  /** Delegated by a wake nobody sent: no account memory (#1513). */
  senderless?: boolean
}): TurnTarget {
  const { room, chatId, message } = input
  const { roomId } = room
  const target = {
    chatId,
    userId: room.userId,
    ...(input.senderless ? { senderless: true } : {}),
    harnessKey: turnHarnessKey(input.model),
  }
  const skills = sketchChatTarget.skills(room, target)
  return {
    skills,
    async prepare() {
      // The client adds the chat record as it sends, so its first turn can
      // beat the record here: make it then, as `ensureRoomChat` does. A chat
      // that exists as anything else isn't this target's.
      const chat = await room
        .mutateDoc(({ chatSessions }) => {
          const existing = chatSessions.get(chatId)
          if (existing) return existing
          const created = sketchChatSession(chatId, Date.now())
          chatSessions.set(chatId, created)
          return created
        })
        .catch(() => undefined)
      if (!isSketchChat(chat)) return null
      const prepared = await prepareChatTarget(
        room,
        sketchChatTarget,
        target,
        toolNamingForTurn(input.model),
        skills
      )
      if (!prepared) return null

      const model = input.model || DEFAULT_MODEL
      await upsertChat({
        chatId,
        roomId,
        // No sandbox, as for the Coordinator.
        sandboxName: "",
        model,
        systemPrompt: prepared.systemPrompt,
      })

      // First-message naming (#910), only while it has its stock name.
      if (chat?.label === SKETCH_CHAT_LABEL) {
        const { chatLabel } = await generateChatNames({
          message,
          shouldNameBranch: false,
          model,
        })
        if (chatLabel) {
          await room.mutateDoc(({ chatSessions }) => {
            if (chatSessions.get(chatId)?.label === SKETCH_CHAT_LABEL)
              chatSessions.update(chatId, { label: chatLabel })
          })
        }
      }

      return {
        systemPrompt: prepared.systemPrompt,
        skillsNote: prepared.skillsNote,
        model,
        tools: prepared.tools,
        userText: prepared.decorateUserMessage(message, {
          isFirstMessage: false,
          delegatedFrom: input.delegatedFrom,
        }),
        // The Coordinator hears how a turn it delegated ended.
        wakesCoordinator: true,
      }
    },
    followUp: (next) =>
      sketchTurn({ ...input, message: next, delegatedFrom: undefined }),
  }
}

/**
 * A chat resuming from a plan decision. It reuses the chat's recorded config
 * (the original run's prompt, model and sandbox); the message is the decision's
 * continuation text, and the turn settles any comment request the plan paused.
 */
export function planResumeTurn(input: {
  room: RoomDoc
  chatId: string
  userId: string
  message: string
  chat: { sandboxName: string; model: string; systemPrompt: string }
}): TurnTarget {
  const { room, chatId, userId, message, chat } = input
  return {
    async prepare() {
      return {
        systemPrompt: chat.systemPrompt,
        model: chat.model,
        // Only the in-process engine has plan decisions (`submit_plan`).
        tools: toolsetOn(
          workspaceChatTarget.tools(room, {
            sandboxName: chat.sandboxName,
            chatId,
            userId,
          }),
          "in-process"
        ),
        userText: message,
        secrets: await sandboxSecrets(chat.sandboxName),
        commentRequest: {
          sandboxName: chat.sandboxName,
          userId,
          threadIds: [],
        },
        wakesCoordinator: true,
      }
    },
    followUp: (next) => planResumeTurn({ ...input, message: next }),
  }
}
