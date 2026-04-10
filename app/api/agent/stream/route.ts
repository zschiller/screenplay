import { auth } from "@clerk/nextjs/server"
import { getClient, getOrCreateAgent, getOrCreateEnvironment } from "@/lib/agent/config"
import { executeCustomTool } from "@/lib/agent/tool-executor"
import type { CustomToolName, AgentStreamEvent } from "@/lib/agent/types"

export const runtime = "nodejs"
export const maxDuration = 300

interface RequestBody {
  sandboxName: string
  message: string
  sessionId?: string
}

function encodeSSE(event: AgentStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
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
        // Get or create agent and environment
        const [agentId, environmentId] = await Promise.all([
          getOrCreateAgent(),
          getOrCreateEnvironment(),
        ])

        // Create or reuse session
        let sessionId = existingSessionId
        if (!sessionId) {
          const session = await client.beta.sessions.create({
            agent: agentId,
            environment_id: environmentId,
          })
          sessionId = session.id
        }
        send({ type: "session_id", sessionId })

        // Open the event stream
        const eventStream = await client.beta.sessions.events.stream(sessionId)

        // Send the user message
        await client.beta.sessions.events.send(sessionId, {
          events: [
            {
              type: "user.message",
              content: [{ type: "text", text: message }],
            },
          ],
        })

        // Track custom tool use events by ID for result routing
        const toolEvents = new Map<
          string,
          { name: string; input: Record<string, unknown> }
        >()

        // Process events
        for await (const event of eventStream) {
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
                // Execute pending custom tool calls
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

                  send({
                    type: "tool_result",
                    name: toolEvent.name,
                    output,
                  })

                  // Send result back to the agent
                  await client.beta.sessions.events.send(sessionId!, {
                    events: [
                      {
                        type: "user.custom_tool_result",
                        custom_tool_use_id: eventId,
                        content: [{ type: "text", text: output }],
                      },
                    ],
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

        // Stream ended without explicit done
        send({ type: "done" })
        controller.close()
      } catch (e) {
        send({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        })
        send({ type: "done" })
        controller.close()
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
