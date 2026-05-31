import { after } from "next/server"
import type { ModelMessage } from "ai"
import { getUserId } from "@/lib/auth-helpers"
import { buildAgentSystemPrompt } from "@/lib/agent/config"
import { getMergedSkillIndexForSandbox } from "@/lib/skills/sandbox-index"
import { toolsetFor } from "@/lib/agent/toolset"
import type { ToolContext } from "@/lib/agent/tools"
import { mutateRoomDoc, readRoomDoc } from "@/lib/yjs/server"
import { buildPlanToolResultMessage, runAgentLoop } from "@/lib/agent/engine"
import {
  agentChatTarget,
  loadLayerDirectory,
  markdownLayerChatTarget,
  prepareChatTarget,
} from "@/lib/agent/chat-target-kinds"
import { DEFAULT_MODEL } from "@/lib/agent/providers"
import {
  appendMessage,
  findPendingPlanForChat,
  loadChatHistory,
  loadChatHistoryForModel,
  upsertChat,
} from "@/lib/agent/persistence"
import { resolvePlan, startRun, transition } from "@/lib/agent/run-state"
import {
  broadcastEvent,
  broadcastSignal,
  StreamBroadcaster,
} from "@/lib/agent/broadcast"
import {
  deduplicateBranchName,
  generateChatNames,
} from "@/lib/agent/naming"

export const runtime = "nodejs"
export const maxDuration = 300

interface RequestBody {
  roomId: string
  chatId: string
  /** Required when the chat targets an agent (sandbox-backed flow). */
  sandboxName?: string
  branch?: string
  /** Required when the chat targets a document layer (no sandbox). */
  markdownLayerId?: string
  message: string
  isFirstChat?: boolean
  autoNamedBranch?: boolean
  planMode?: boolean
  model?: string
}

export async function POST(req: Request) {
  const userId = await getUserId()
  if (!userId) return new Response("Unauthorized", { status: 401 })

  const body: RequestBody = await req.json()
  const {
    roomId,
    chatId,
    sandboxName,
    branch,
    markdownLayerId,
    message,
    isFirstChat,
    autoNamedBranch,
    planMode,
    model,
  } = body
  if (!roomId || !chatId || !message) {
    return new Response("Missing required fields", { status: 400 })
  }
  if (!markdownLayerId && !sandboxName) {
    return new Response(
      "Missing target: markdownLayerId or sandboxName",
      { status: 400 },
    )
  }

  // Layer-targeted chats defer all of their kind-specific bits — system
  // prompt, tools, message decoration — to a registered `ChatTargetSpec`.
  // Adding a new chat-targetable kind means shipping a spec and a route
  // branch; the surrounding agent loop is unchanged.
  const layerChat:
    | { spec: typeof markdownLayerChatTarget; target: { markdownLayerId: string } }
    | null = markdownLayerId
      ? { spec: markdownLayerChatTarget, target: { markdownLayerId } }
      : null
  if (layerChat) {
    const prepared = await prepareChatTarget(
      roomId,
      // The discriminating union above keeps spec/target paired; cast through
      // `never` so prepareChatTarget's generic doesn't try to unify them.
      layerChat.spec as unknown as Parameters<typeof prepareChatTarget>[1],
      layerChat.target as unknown as never,
    )
    if (!prepared) return new Response("Layer not found", { status: 404 })

    const effectiveModel = model || DEFAULT_MODEL
    await upsertChat({
      chatId,
      roomId,
      // No sandbox — pass an empty string so the persistence layer's NOT NULL
      // constraint is satisfied; it's never read back for layer chats.
      sandboxName: "",
      model: effectiveModel,
      systemPrompt: prepared.systemPrompt,
    })

    const userText = prepared.decorateUserMessage(message, {
      planMode,
      isFirstMessage: false,
    })
    const userMessage: ModelMessage = { role: "user", content: userText }
    await appendMessage(chatId, userMessage)

    const history = await loadChatHistoryForModel(chatId)
    const runId = await startRun(chatId)

    // Broadcast the start signal and echo the user message synchronously so
    // the client transitions into the streaming state before the response
    // returns. If the `after()` callback never runs (cold-start eviction,
    // OOM, container drain), the safety net inside it ensures the UI
    // doesn't get stranded with an indefinite spinner.
    await broadcastSignal(roomId, chatId, "chat-stream-start")
    const broadcaster = new StreamBroadcaster(roomId, chatId)
    await broadcaster.onUserMessage(message)

    after(async () => {
      try {
        await runAgentLoop({
          chatId,
          runId,
          roomId,
          systemPrompt: prepared.systemPrompt,
          model: effectiveModel,
          tools: prepared.tools,
          messages: history,
        })
      } catch (e) {
        console.error("runAgentLoop failed (layer chat):", e)
        const msg = e instanceof Error ? e.message : String(e)
        try {
          await broadcastEvent(roomId, chatId, { type: "error", message: msg })
        } finally {
          await transition(runId, "failed").catch(() => {})
          await broadcastSignal(roomId, chatId, "chat-stream-end")
        }
      }
    })

    return Response.json({ chatId, runId })
  }

  // Below this line: agent-targeted (sandbox) flow. `sandboxName` is
  // guaranteed by the early-return above.
  if (!sandboxName) {
    return new Response("Missing sandboxName for agent-targeted chat", { status: 400 })
  }

  // First-message check: a chat is "new" if it has no prior messages. More
  // reliable than the client-supplied `isFirstChat` since it also covers the
  // case where v2 is being mounted onto an existing chat.
  const isNewChat = (await loadChatHistory(chatId)).length === 0

  const effectiveModel = model || DEFAULT_MODEL
  const toolCtx: ToolContext = { sandboxName, roomId, userId }

  // Repo-scoped optional system prompt + the merged App∪Repo Skill index. The
  // Skill index is enumerated once here, at chat init, from this Branch's
  // sandbox (`.claude/skills/`) and baked into the per-Agent prompt — one
  // sandbox round-trip per new chat.
  const [repoSystemPrompt, layerDirectory, skills] = await Promise.all([
    readRoomDoc(roomId, ({ branches, repos }) => {
      const branch = branches.toArray().find((a) => a.sandboxName === sandboxName)
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

  await upsertChat({
    chatId,
    roomId,
    sandboxName,
    model: effectiveModel,
    systemPrompt,
  })

  // First-message branch + chat-label naming so chats get auto-named without
  // the user picking a branch.
  let effectiveBranch = branch
  if (isNewChat && isFirstChat !== false) {
    const shouldNameBranch = autoNamedBranch !== false
    const { branch: rawBranch, chatLabel } = await generateChatNames({
      message,
      shouldNameBranch,
      model: effectiveModel,
    })
    if (shouldNameBranch && rawBranch) {
      effectiveBranch = await deduplicateBranchName(roomId, rawBranch, userId)
      await broadcastEvent(roomId, chatId, {
        type: "branch_rename",
        branch: effectiveBranch,
      })
    }
    if (chatLabel) {
      // Persist the label directly so it survives a client re-render that
      // momentarily clears the broadcast callback.
      await mutateRoomDoc(roomId, ({ chatSessions }) => {
        chatSessions.update(chatId, { label: chatLabel })
      })
      await broadcastEvent(roomId, chatId, {
        type: "chat_rename",
        label: chatLabel,
      })
    }
  }

  // If the user sent a follow-up message while a submit_plan is still
  // pending approval, treat the new message as the rejection feedback and
  // resolve the plan before continuing. Without this the conversation log
  // would have an unresolved tool-call followed by a user message, which
  // every provider rejects with a 400 ("tool_use must have a corresponding
  // tool_result").
  const pendingPlan = await findPendingPlanForChat(chatId)
  if (pendingPlan) {
    // The follow-up message is an implicit rejection: resolve the plan and
    // supersede its paused run atomically before the new run starts.
    await resolvePlan(pendingPlan.id, {
      approved: false,
      feedback: message,
    })
    await appendMessage(
      chatId,
      buildPlanToolResultMessage({
        toolCallId: pendingPlan.id,
        approved: false,
        feedback: message,
      }),
    )
    await broadcastEvent(roomId, chatId, {
      type: "plan_rejected",
      planId: pendingPlan.id,
      feedback: message,
    })
  }

  // Append the user message with the plan/branch prefixes the agent's system
  // prompt looks for. The Chat Target spec owns the policy (branch only on
  // the first message) and delegates the format to the Message Markers codec
  // — there is exactly one encode path.
  const userText = agentChatTarget.decorateUserMessage!(message, {
    planMode,
    branch: effectiveBranch,
    isFirstMessage: isNewChat,
  })
  const userMessage: ModelMessage = { role: "user", content: userText }
  await appendMessage(chatId, userMessage)

  const history = await loadChatHistoryForModel(chatId)
  const runId = await startRun(chatId)

  // Broadcast the start signal and echo the user message synchronously so
  // the client transitions into streaming before the response returns —
  // otherwise a failed/dropped `after()` callback would strand the chat with
  // a persisted user message and no indication anything is happening.
  await broadcastSignal(roomId, chatId, "chat-stream-start")
  const broadcaster = new StreamBroadcaster(roomId, chatId)
  await broadcaster.onUserMessage(message)

  // Kick off the loop in the background and return immediately — the client
  // receives state via the Y.Doc broadcast channel.
  after(async () => {
    try {
      await runAgentLoop({
        chatId,
        runId,
        roomId,
        systemPrompt,
        model: effectiveModel,
        tools: toolsetFor({ kind: "sandbox", roomId, sandbox: toolCtx }),
        messages: history,
      })
    } catch (e) {
      console.error("runAgentLoop failed:", e)
      const msg = e instanceof Error ? e.message : String(e)
      try {
        await broadcastEvent(roomId, chatId, { type: "error", message: msg })
      } finally {
        await transition(runId, "failed").catch(() => {})
        await broadcastSignal(roomId, chatId, "chat-stream-end")
      }
    }
  })

  return Response.json({ chatId, runId })
}
