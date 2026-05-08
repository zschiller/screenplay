import { after } from "next/server"
import type { ModelMessage } from "ai"
import { getUserId } from "@/lib/auth-helpers"
import { buildAgentSystemPrompt } from "@/lib/agent/config"
import type { ToolContext } from "@/lib/agent/tool-executor"
import { mutateRoomDoc, readRoomDoc } from "@/lib/yjs/server"
import { buildPlanToolResultMessage, runAgentLoop } from "@/lib/agent/engine"
import {
  documentChatTarget,
  prepareChatTarget,
} from "@/lib/agent/chat-target-kinds"
import { DEFAULT_MODEL } from "@/lib/agent/providers"
import {
  appendMessage,
  findPendingPlanForChat,
  loadChatHistory,
  resolvePendingToolCall,
  startRun,
  upsertChat,
} from "@/lib/agent/persistence"
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
  documentId?: string
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
    documentId,
    message,
    isFirstChat,
    autoNamedBranch,
    planMode,
    model,
  } = body
  if (!roomId || !chatId || !message) {
    return new Response("Missing required fields", { status: 400 })
  }
  if (!documentId && !sandboxName) {
    return new Response("Missing target: documentId or sandboxName", { status: 400 })
  }

  // Layer-targeted chats (currently just documents) defer all of their
  // kind-specific bits — system prompt, tools, message decoration — to a
  // registered `ChatTargetSpec`. Adding a new chat-targetable kind means
  // shipping a spec and a route branch; the surrounding agent loop is
  // unchanged.
  if (documentId) {
    const prepared = await prepareChatTarget(roomId, documentChatTarget, {
      documentId,
    })
    if (!prepared) return new Response("Document not found", { status: 404 })

    const effectiveModel = model || DEFAULT_MODEL
    await upsertChat({
      chatId,
      roomId,
      // No sandbox — pass an empty string so the persistence layer's NOT NULL
      // constraint is satisfied; it's never read back for doc chats.
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

    const history = await loadChatHistory(chatId)
    const runId = await startRun(chatId)

    after(async () => {
      await broadcastSignal(roomId, chatId, "chat-stream-start")
      const broadcaster = new StreamBroadcaster(roomId, chatId)
      await broadcaster.onUserMessage(message)
      await runAgentLoop({
        chatId,
        runId,
        roomId,
        systemPrompt: prepared.systemPrompt,
        model: effectiveModel,
        tools: prepared.tools,
        messages: history,
      })
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

  // Workspace-scoped optional system prompt — appended to the live skill
  // index so each (workspace, model) pair sees the right persona.
  const workspaceSystemPrompt = await readRoomDoc(roomId, ({ agents, workspaces }) => {
    const agent = agents.toArray().find((a) => a.sandboxName === sandboxName)
    if (!agent) return undefined
    return workspaces.get(agent.workspaceId)?.systemPrompt
  }).catch(() => undefined)

  const systemPrompt = buildAgentSystemPrompt(workspaceSystemPrompt ?? undefined)

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
    await resolvePendingToolCall(pendingPlan.id, {
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

  // Append the user message with the same plan/branch prefixes the agent's
  // system prompt looks for.
  const planPrefix = planMode ? "[plan mode: enabled] " : ""
  const branchPrefix =
    isNewChat && effectiveBranch ? `[branch: ${effectiveBranch}] ` : ""
  const userText = `${planPrefix}${branchPrefix}${message}`
  const userMessage: ModelMessage = { role: "user", content: userText }
  await appendMessage(chatId, userMessage)

  const history = await loadChatHistory(chatId)
  const runId = await startRun(chatId)

  // Kick off the loop in the background and return immediately — the client
  // receives state via the Y.Doc broadcast channel.
  after(async () => {
    await broadcastSignal(roomId, chatId, "chat-stream-start")
    const broadcaster = new StreamBroadcaster(roomId, chatId)
    await broadcaster.onUserMessage(message)

    await runAgentLoop({
      chatId,
      runId,
      roomId,
      systemPrompt,
      model: effectiveModel,
      toolCtx,
      messages: history,
    })
  })

  return Response.json({ chatId, runId })
}
