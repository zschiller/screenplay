import "server-only"

import { after } from "next/server"
import { buildAgentSystemPrompt } from "./config"
import { getMergedSkillIndexForSandbox } from "@/lib/skills/sandbox-index"
import { toolsetFor } from "./toolset"
import type { ToolContext } from "./tools"
import { mutateRoomDoc, readRoomDoc } from "@/lib/yjs/server"
import {
  agentChatTarget,
  loadLayerDirectory,
  markdownLayerChatTarget,
  prepareChatTarget,
} from "./chat-target-kinds"
import { DEFAULT_MODEL } from "./providers"
import {
  appendAcpMessage,
  findPendingPlanForChat,
  loadAcpHistory,
  upsertChat,
} from "./persistence"
import { resolvePlan, startRun } from "./run-state"
import {
  broadcastAcpUpdate,
  broadcastControl,
  broadcastSignal,
} from "./broadcast"
import { resolveLiveEngine } from "./acp/resolve-live-engine"
import { wireToContentBlocks } from "./acp/markers"
import { launchEngineTurn } from "./launch-turn"
import { deduplicateBranchName, generateChatNames } from "./naming"
import {
  queueCommentRequest,
  settleCommentRequest,
  startCommentRequest,
} from "./comment-request"
import type { TurnLaunchDeps, TurnTarget } from "./turn-launch"

/** Turn Launch over the live database, Room broadcast and `after()`. */
export const liveTurnLaunchDeps: TurnLaunchDeps = {
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
  queueCommentRequest,
  startCommentRequest,
  settleCommentRequest,
  driveTurn: launchEngineTurn,
  runAfterResponse: (task) => after(task),
}

/**
 * A chat on a Markdown Layer: no sandbox, and its kind-specific bits (system
 * prompt, tools, message decoration) come from the layer's `ChatTargetSpec`.
 */
export function markdownLayerTurn(input: {
  roomId: string
  chatId: string
  markdownLayerId: string
  message: string
  model?: string
}): TurnTarget {
  return {
    async prepare() {
      const prepared = await prepareChatTarget(
        input.roomId,
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
        roomId: input.roomId,
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

/** A chat on a Branch's sandbox. */
export function sandboxTurn(input: {
  roomId: string
  chatId: string
  sandboxName: string
  userId: string
  message: string
  branch?: string
  isFirstChat?: boolean
  autoNamedBranch?: boolean
  planMode?: boolean
  model?: string
  commentThreadIds?: string[]
}): TurnTarget {
  const { roomId, chatId, sandboxName, userId, message, planMode } = input
  return {
    async prepare() {
      // A chat is "new" if it has no prior ACP-native records. More reliable
      // than the client-supplied `isFirstChat`.
      const isNewChat = (await loadAcpHistory(chatId)).length === 0
      const model = input.model || DEFAULT_MODEL
      const toolCtx: ToolContext = { sandboxName, roomId, userId }

      // Repo-scoped optional system prompt + the merged App∪Repo Skill index,
      // enumerated from this Branch's sandbox (`.claude/skills/`) and baked into
      // the per-Agent prompt.
      const [repoSystemPrompt, layerDirectory, skills] = await Promise.all([
        readRoomDoc(roomId, ({ branches, repos }) => {
          const branch = branches
            .toArray()
            .find((a) => a.sandboxName === sandboxName)
          if (!branch) return undefined
          return repos.get(branch.repoId)?.systemPrompt
        }).catch(() => undefined),
        loadLayerDirectory(roomId),
        getMergedSkillIndexForSandbox(sandboxName),
      ])
      const systemPrompt = buildAgentSystemPrompt({
        repoSystemPrompt: repoSystemPrompt ?? undefined,
        layerDirectory,
        skills,
      })

      await upsertChat({ chatId, roomId, sandboxName, model, systemPrompt })

      // First-message naming. Every new chat earns a label; the branch rename is
      // narrower: only the first chat on the branch, and only while the branch
      // is still auto-named, so a later chat can't rename it under its
      // siblings. Turn Launch broadcasts the renames inside the replay window.
      let effectiveBranch = input.branch
      const renames: { branch?: string; label?: string } = {}
      if (isNewChat) {
        const shouldNameBranch =
          input.autoNamedBranch !== false && input.isFirstChat !== false
        const {
          branch: rawBranch,
          chatLabel,
          title,
        } = await generateChatNames({
          message,
          shouldNameBranch,
          model,
        })
        if (shouldNameBranch && rawBranch) {
          effectiveBranch = await deduplicateBranchName(
            roomId,
            rawBranch,
            userId
          )
          renames.branch = effectiveBranch
        }
        // The Workspace takes its title from the same call (#881), written
        // here on the server so every client path that sends a first message
        // gets it. A title already set (a rename, or an earlier naming) is
        // never replaced.
        if (shouldNameBranch && title) {
          await mutateRoomDoc(roomId, ({ branches }) => {
            const workspace = branches
              .toArray()
              .find((b) => b.sandboxName === sandboxName)
            if (workspace && !workspace.title?.trim()) {
              branches.update(workspace.id, { title })
            }
          })
        }
        if (chatLabel) {
          renames.label = chatLabel
          // Persist the label directly so it survives a client re-render that
          // momentarily clears the broadcast callback.
          await mutateRoomDoc(roomId, ({ chatSessions }) => {
            chatSessions.update(chatId, { label: chatLabel })
          })
        }
      }

      return {
        systemPrompt,
        model,
        tools: toolsetFor({ kind: "sandbox", roomId, sandbox: toolCtx }),
        // The Chat Target spec owns the marker policy (branch only on the
        // first message) and delegates the format to the Message Markers codec.
        userText: agentChatTarget.decorateUserMessage!(message, {
          planMode,
          branch: effectiveBranch,
          isFirstMessage: isNewChat,
        }),
        planMode,
        renames,
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
  roomId: string
  userId: string
  message: string
  chat: { sandboxName: string; model: string; systemPrompt: string }
}): TurnTarget {
  const { roomId, userId, message, chat } = input
  return {
    async prepare() {
      const toolCtx: ToolContext = {
        sandboxName: chat.sandboxName,
        roomId,
        userId,
      }
      return {
        systemPrompt: chat.systemPrompt,
        model: chat.model,
        tools: toolsetFor({ kind: "sandbox", roomId, sandbox: toolCtx }),
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
