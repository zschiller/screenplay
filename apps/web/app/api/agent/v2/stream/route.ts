import { after } from "next/server"
import type { ModelMessage } from "ai"
import { getUserId } from "@/lib/auth-helpers"
import { buildAgentSystemPrompt, DEFAULT_AGENT_MODEL } from "@/lib/agent/config"
import type { ToolContext } from "@/lib/agent/tool-executor"
import { readRoomDoc } from "@/lib/yjs/server"
import { runAgentLoop } from "@/lib/agent/v2/engine"
import {
  appendMessage,
  loadChatHistory,
  startRun,
  upsertChat,
} from "@/lib/agent/v2/persistence"
import { broadcastSignal, StreamBroadcaster } from "@/lib/agent/v2/broadcast"

export const runtime = "nodejs"
export const maxDuration = 300

interface RequestBody {
  roomId: string
  chatId: string
  sandboxName: string
  branch: string
  message: string
  planMode?: boolean
  model?: string
}

export async function POST(req: Request) {
  const userId = await getUserId()
  if (!userId) return new Response("Unauthorized", { status: 401 })

  const body: RequestBody = await req.json()
  const { roomId, chatId, sandboxName, branch, message, planMode, model } = body
  if (!roomId || !chatId || !sandboxName || !message) {
    return new Response("Missing required fields", { status: 400 })
  }

  const effectiveModel = model || DEFAULT_AGENT_MODEL
  const toolCtx: ToolContext = { sandboxName, roomId, userId }

  // Resolve the workspace's optional system prompt the same way v1 does — the
  // agent's persona is per-workspace + skills, derived live from disk.
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

  // Append the user message (with optional plan/branch prefixes — kept
  // identical to v1 so the agent sees the same prompt shape).
  const planPrefix = planMode ? "[plan mode: enabled] " : ""
  const branchPrefix = branch ? `[branch: ${branch}] ` : ""
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
