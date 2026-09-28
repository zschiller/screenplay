import "server-only"

import { after } from "next/server"
import { buildAgentSystemPrompt } from "./config"
import { getMergedSkillIndexForSandbox } from "@/lib/skills/sandbox-index"
import { toolsetFor } from "./toolset"
import type { ToolContext } from "./tools"
import type { RoomDoc } from "@/lib/room-access"
import {
  agentChatTarget,
  loadLayerDirectory,
  markdownLayerChatTarget,
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
  loadAcpHistory,
  upsertChat,
} from "./persistence"
import { resolvePlan, startRun, transition } from "./run-state"
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
import type { TurnLaunchDeps, TurnStopDeps, TurnTarget } from "./turn-launch"

/**
 * Turn Launch over the live database, Room broadcast and `after()`, for a turn
 * in `room` (the route's Room Access). The comment hooks write the room's
 * doorbell through it; their `roomId` is the same Room.
 */
export const liveTurnLaunchDeps = (room: RoomDoc): TurnLaunchDeps => ({
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
  runAfterResponse: (task) => after(task),
})

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
}): TurnTarget {
  const { room, chatId } = input
  return {
    async prepare() {
      await ensureRoomChat(room)
      const prepared = await prepareChatTarget(
        room,
        roomChatTarget as unknown as Parameters<typeof prepareChatTarget>[1],
        { userId: room.userId } as unknown as never
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
      const [branchState, layerDirectory, skills] = await Promise.all([
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
      ])
      const systemPrompt = buildAgentSystemPrompt({
        repoSystemPrompt: branchState?.systemPrompt ?? undefined,
        layerDirectory,
        skills,
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
      }
    },
  }
}
