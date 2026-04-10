import { after } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { Redis } from "@upstash/redis"
import { getClient, getOrCreateAgent, getOrCreateEnvironment } from "@/lib/agent/config"
import { executeCustomTool } from "@/lib/agent/tool-executor"
import type { CustomToolName, AgentStreamEvent } from "@/lib/agent/types"

export const runtime = "nodejs"
export const maxDuration = 300

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

interface RequestBody {
  sandboxName: string
  message: string
  sessionId?: string
}

function encodeSSE(event: AgentStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
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
    // Could be idle with end_turn (ready) or requires_action (stuck)
    await resolveStuckToolCalls(sessionId, sandboxName)
    // After resolving, the session may be running again — wait for idle
    const updated = await client.beta.sessions.retrieve(sessionId)
    if (updated.status === "running") {
      await waitForIdle(client, sessionId)
    }
    return
  }

  if (session.status === "running") {
    await waitForIdle(client, sessionId)
    // After idle, check if it needs tool call resolution
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
  // Poll session status instead of opening a competing stream
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const s = await client.beta.sessions.retrieve(sessionId)
    if (s.status === "idle" || s.status === "terminated") return
  }
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) {
    return new Response("Unauthorized", { status: 401 })
  }

  const body: RequestBody = await req.json()
  const { sandboxName, message, sessionId: existingSessionId } = body

  if (!sandboxName || !message) {
    return new Response("Missing sandboxName or message", { status: 400 })
  }

  const client = getClient()

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: AgentStreamEvent) => {
        controller.enqueue(encoder.encode(encodeSSE(event)))
      }

      try {
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
          // Make sure the session is ready for a new message
          await ensureSessionReady(client, sessionId, sandboxName)
        }

        send({ type: "session_id", sessionId })

        // Send the user message
        await client.beta.sessions.events.send(sessionId, {
          events: [{
            type: "user.message",
            content: [{ type: "text", text: message }],
          }],
        })

        // Safety net for client disconnect
        after(() => resolveStuckToolCalls(sessionId!, sandboxName))

        // Stream events. For new sessions this is clean.
        // For existing sessions, we'll see replayed history — skip until
        // we see the user.message we just sent, then process everything after.
        const eventStream = await client.beta.sessions.events.stream(sessionId)

        const toolEvents = new Map<
          string,
          { name: string; input: Record<string, unknown> }
        >()

        let seenOurMessage = !existingSessionId // new sessions: no history to skip

        for await (const event of eventStream) {
          // For existing sessions, skip replayed history until we see
          // the user.message we just sent
          if (!seenOurMessage) {
            if (
              event.type === "user.message" &&
              Array.isArray(event.content) &&
              event.content.some(
                (b: { type: string; text?: string }) =>
                  "text" in b && b.text === message,
              )
            ) {
              // This could be an older identical message — track by checking
              // if the NEXT event after this is for our current turn.
              // Simplest: just mark the last matching user.message as ours.
              seenOurMessage = true
            }
            continue
          }

          // Skip the user.message event itself and status_running
          if (event.type === "user.message") continue
          if (event.type === "session.status_running") continue

          switch (event.type) {
            case "agent.message": {
              for (const block of event.content) {
                if ("text" in block) {
                  send({ type: "text", text: block.text })
                }
              }
              break
            }

            case "agent.custom_tool_use": {
              const toolName = event.name as CustomToolName
              const toolInput = event.input as Record<string, unknown>
              toolEvents.set(event.id, { name: toolName, input: toolInput })
              send({ type: "tool_use", name: toolName, input: toolInput })
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

                  send({ type: "tool_result", name: toolEvent.name, output })

                  await client.beta.sessions.events.send(sessionId, {
                    events: [{
                      type: "user.custom_tool_result",
                      custom_tool_use_id: eventId,
                      content: [{ type: "text", text: output }],
                    }],
                  })
                }
              } else if (stopReason?.type === "end_turn") {
                send({ type: "done" })
                controller.close()
                return
              }
              break
            }

            case "session.error": {
              send({
                type: "error",
                message:
                  (event as { error?: { message?: string } }).error?.message ??
                  "Unknown agent error",
              })
              break
            }

            case "session.status_terminated": {
              send({ type: "error", message: "Session terminated" })
              send({ type: "done" })
              controller.close()
              return
            }
          }
        }

        send({ type: "done" })
        controller.close()
      } catch (e) {
        send({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        })
        send({ type: "done" })
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
