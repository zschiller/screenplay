import { after } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { Redis } from "@upstash/redis"
import { getClient, getOrCreateAgent, getOrCreateEnvironment } from "@/lib/agent/config"
import { executeCustomTool } from "@/lib/agent/tool-executor"
import type { CustomToolName, AgentStreamEvent } from "@/lib/agent/types"
import { liveblocks } from "@/lib/liveblocks-server"

export const runtime = "nodejs"
export const maxDuration = 300

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

interface RequestBody {
  roomId: string
  chatId: string
  sandboxName: string
  branch: string
  message: string
  sessionId?: string
  isFirstChat?: boolean
}

/**
 * Safety net: resolve stuck tool calls if the handler died mid-execution.
 */
async function resolveStuckToolCalls(sessionId: string, sandboxName: string) {
  const lockKey = `session-recover:${sessionId}`
  const locked = await redis.set(lockKey, "1", { nx: true, ex: 120 })
  if (locked !== "OK") return

  const client = getClient()
  try {
    const session = await client.beta.sessions.retrieve(sessionId)
    if (session.status !== "idle") return

    const recent = await client.beta.sessions.events.list(sessionId, {
      limit: 50,
      order: "desc",
    })
    const idle = recent.data.find((e) => e.type === "session.status_idle")
    if (
      idle?.type !== "session.status_idle" ||
      idle.stop_reason?.type !== "requires_action"
    ) return

    for (const eid of idle.stop_reason.event_ids) {
      const tu = recent.data.find(
        (e) => e.type === "agent.custom_tool_use" && e.id === eid,
      )
      let output = "Tool execution was interrupted."
      if (tu?.type === "agent.custom_tool_use") {
        try {
          output = await executeCustomTool(
            sandboxName,
            tu.name as CustomToolName,
            tu.input as Record<string, unknown>,
          )
        } catch (e) {
          output = `Error: ${e instanceof Error ? e.message : String(e)}`
        }
      }
      await client.beta.sessions.events.send(sessionId, {
        events: [{
          type: "user.custom_tool_result",
          custom_tool_use_id: eid,
          content: [{ type: "text", text: output }],
        }],
      })
    }
  } finally {
    await redis.del(lockKey)
  }
}

/**
 * Ensure a session is in idle+end_turn state before sending a new message.
 */
async function ensureSessionReady(
  client: ReturnType<typeof getClient>,
  sessionId: string,
  sandboxName: string,
) {
  const session = await client.beta.sessions.retrieve(sessionId)

  if (session.status === "terminated") {
    throw new Error("Session terminated")
  }

  if (session.status === "idle") {
    await resolveStuckToolCalls(sessionId, sandboxName)
    const updated = await client.beta.sessions.retrieve(sessionId)
    if (updated.status === "running") {
      await waitForIdle(client, sessionId)
    }
    return
  }

  if (session.status === "running") {
    await waitForIdle(client, sessionId)
    await resolveStuckToolCalls(sessionId, sandboxName)
    const updated = await client.beta.sessions.retrieve(sessionId)
    if (updated.status === "running") {
      await waitForIdle(client, sessionId)
    }
  }
}

async function waitForIdle(
  client: ReturnType<typeof getClient>,
  sessionId: string,
) {
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const s = await client.beta.sessions.retrieve(sessionId)
    if (s.status === "idle" || s.status === "terminated") return
  }
}

/**
 * Broadcast a chat event to all clients in the room via Liveblocks.
 */
async function broadcastChatEvent(roomId: string, chatId: string, event: AgentStreamEvent) {
  try {
    await liveblocks.broadcastEvent(roomId, {
      type: "chat-stream",
      chatId,
      event: JSON.parse(JSON.stringify(event)),
    })
  } catch (e) {
    console.error("Broadcast failed:", e)
  }
}

async function broadcastChatSignal(roomId: string, chatId: string, signal: "chat-stream-start" | "chat-stream-end") {
  try {
    await liveblocks.broadcastEvent(roomId, {
      type: signal,
      chatId,
    })
  } catch (e) {
    console.error("Broadcast failed:", e)
  }
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) {
    return new Response("Unauthorized", { status: 401 })
  }

  const body: RequestBody = await req.json()
  const { roomId, chatId, sandboxName, branch, message, sessionId: existingSessionId, isFirstChat } = body

  if (!roomId || !chatId || !sandboxName || !message) {
    return new Response("Missing required fields", { status: 400 })
  }

  const client = getClient()

  // Resolve agent + environment up front
  const [agentId, environmentId] = await Promise.all([
    getOrCreateAgent(),
    getOrCreateEnvironment(),
  ])

  let sessionId = existingSessionId
  if (!sessionId) {
    const session = await client.beta.sessions.create({
      agent: agentId,
      environment_id: environmentId,
    })
    sessionId = session.id
  } else {
    await ensureSessionReady(client, sessionId, sandboxName)
  }

  // Broadcast session_id to all clients immediately
  broadcastChatEvent(roomId, chatId, { type: "session_id", sessionId })

  // For new sessions on the first chat, generate a descriptive branch name and chat label
  let effectiveBranch = branch
  if (!existingSessionId && isFirstChat !== false) {
    try {
      const nameRes = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 60,
        system: "Generate two things for the user's request:\n1. A short, lowercase, hyphenated git branch name (2-4 words)\n2. A short chat label (2-5 words, title case)\n\nOutput ONLY as two lines, no explanation, backticks, or quotes.\nLine 1: branch name\nLine 2: chat label\n\nExamples:\nfix-login-button\nFix Login Button\n\nadd-dark-mode\nAdd Dark Mode",
        messages: [{ role: "user", content: message }],
      })
      const rawText = nameRes.content[0]?.type === "text" ? nameRes.content[0].text.trim() : ""
      const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean)

      const rawBranch = (lines[0] ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
      if (rawBranch.length >= 3 && rawBranch.length <= 50) {
        effectiveBranch = rawBranch
        await broadcastChatEvent(roomId, chatId, { type: "branch_rename", branch: rawBranch })
      }

      const chatLabel = lines[1] ?? ""
      if (chatLabel.length >= 2 && chatLabel.length <= 60) {
        await broadcastChatEvent(roomId, chatId, { type: "chat_rename", label: chatLabel })
      }
    } catch (e) {
      console.error("Branch/chat rename generation failed:", e)
    }
  }

  // Return the session ID immediately — streaming happens in the background
  const responseSessionId = sessionId

  // Run the actual agent streaming in the background via next/server `after`
  after(async () => {
    try {
      await broadcastChatSignal(roomId, chatId, "chat-stream-start")
      await broadcastChatEvent(roomId, chatId, { type: "user_message", text: message })

      const userText = !existingSessionId && effectiveBranch
        ? `[branch: ${effectiveBranch}] ${message}`
        : message

      const sendResult = await client.beta.sessions.events.send(sessionId!, {
        events: [{
          type: "user.message" as const,
          content: [{ type: "text" as const, text: userText }],
        }],
      })
      const ourMessageId = sendResult.data?.[0]?.id

      const eventStream = await client.beta.sessions.events.stream(sessionId!)

      const toolEvents = new Map<
        string,
        { name: string; input: Record<string, unknown> }
      >()

      let seenOurMessage = !existingSessionId

      for await (const event of eventStream) {
        if (!seenOurMessage) {
          if (
            event.type === "user.message" &&
            ourMessageId &&
            event.id === ourMessageId
          ) {
            seenOurMessage = true
          }
          continue
        }

        if (event.type === "user.message") continue
        if (event.type === "session.status_running") continue

        switch (event.type) {
          case "agent.message": {
            let text = ""
            for (const block of event.content) {
              if ("text" in block) {
                text += block.text
              }
            }
            if (text) {
              await broadcastChatEvent(roomId, chatId, { type: "text", text })
            }
            break
          }

          case "agent.custom_tool_use": {
            const toolName = event.name as CustomToolName
            const toolInput = event.input as Record<string, unknown>
            toolEvents.set(event.id, { name: toolName, input: toolInput })
            await broadcastChatEvent(roomId, chatId, { type: "tool_use", name: toolName, input: toolInput })
            break
          }

          case "session.status_idle": {
            const stopReason = event.stop_reason
            if (stopReason?.type === "requires_action") {
              for (const eventId of stopReason.event_ids) {
                const toolEvent = toolEvents.get(eventId)
                if (!toolEvent) continue

                let output: string
                try {
                  output = await executeCustomTool(
                    sandboxName,
                    toolEvent.name as CustomToolName,
                    toolEvent.input,
                  )
                } catch (e) {
                  output = `Error: ${e instanceof Error ? e.message : String(e)}`
                }

                await broadcastChatEvent(roomId, chatId, { type: "tool_result", name: toolEvent.name, output })

                await client.beta.sessions.events.send(sessionId!, {
                  events: [{
                    type: "user.custom_tool_result",
                    custom_tool_use_id: eventId,
                    content: [{ type: "text", text: output }],
                  }],
                })
              }
            } else if (stopReason?.type === "end_turn") {
              await broadcastChatEvent(roomId, chatId, { type: "done" })
              await broadcastChatSignal(roomId, chatId, "chat-stream-end")
              return
            }
            break
          }

          case "session.error": {
            await broadcastChatEvent(roomId, chatId, {
              type: "error",
              message:
                (event as { error?: { message?: string } }).error?.message ??
                "Unknown agent error",
            })
            break
          }

          case "session.status_terminated": {
            await broadcastChatEvent(roomId, chatId, { type: "error", message: "Session terminated" })
            await broadcastChatEvent(roomId, chatId, { type: "done" })
            await broadcastChatSignal(roomId, chatId, "chat-stream-end")
            return
          }
        }
      }

      await broadcastChatEvent(roomId, chatId, { type: "done" })
      await broadcastChatSignal(roomId, chatId, "chat-stream-end")
    } catch (e) {
      await broadcastChatEvent(roomId, chatId, {
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      })
      await broadcastChatEvent(roomId, chatId, { type: "done" })
      await broadcastChatSignal(roomId, chatId, "chat-stream-end")
    }
  })

  // Safety net for stuck tool calls
  after(() => resolveStuckToolCalls(responseSessionId, sandboxName))

  return Response.json({ sessionId: responseSessionId })
}
