import { after } from "next/server"
import { getUserId } from "@/lib/auth-helpers"
import { getClient } from "@/lib/agent/config"
import { executeCustomTool, type ToolContext } from "@/lib/agent/tool-executor"
import type { CustomToolName, AgentStreamEvent } from "@/lib/agent/types"
import { broadcastChatEventViaDoc, mutateRoomDoc } from "@/lib/yjs/server"
import type { PlanData } from "@/lib/types"

export const runtime = "nodejs"
export const maxDuration = 300

interface RequestBody {
  roomId: string
  chatId: string
  planId: string
  approved: boolean
  feedback?: string
}

async function broadcastChatEvent(roomId: string, chatId: string, event: AgentStreamEvent) {
  try {
    await broadcastChatEventViaDoc(roomId, {
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
    await broadcastChatEventViaDoc(roomId, { type: signal, chatId })
  } catch (e) {
    console.error("Broadcast failed:", e)
  }
}

export async function POST(req: Request) {
  const userId = await getUserId()
  if (!userId) {
    return new Response("Unauthorized", { status: 401 })
  }

  const body: RequestBody = await req.json()
  const { roomId, chatId, planId, approved, feedback } = body

  if (!roomId || !chatId || !planId) {
    return new Response("Missing required fields", { status: 400 })
  }

  const planData = await mutateRoomDoc(roomId, ({ plans }) => {
    const existing = plans.get(planId)
    if (!existing) return null

    plans.update(planId, {
      status: approved ? "approved" : "rejected",
      resolvedAt: Date.now(),
      ...(!approved && feedback ? { feedback } : {}),
    })

    return existing
  })
  if (!planData) {
    return new Response("Plan not found", { status: 404 })
  }

  if (planData.status !== "pending") {
    return new Response("Plan already resolved", { status: 409 })
  }

  const client = getClient()
  const { sessionId, toolEventId } = planData
  const toolCtx: ToolContext = {
    sandboxName: planData.agentId,
    roomId,
    userId,
  }

  // Broadcast approval/rejection to all clients
  if (approved) {
    await broadcastChatEvent(roomId, chatId, { type: "plan_approved", planId })
  } else {
    await broadcastChatEvent(roomId, chatId, {
      type: "plan_rejected",
      planId,
      feedback: feedback ?? "No feedback provided",
    })
  }

  // Resolve ALL pending tool calls — the session requires all before it continues
  const recent = await client.beta.sessions.events.list(sessionId, {
    limit: 50,
    order: "desc",
  })
  const idle = recent.data.find((e) => e.type === "session.status_idle")

  const toolResultEvents: Array<{
    type: "user.custom_tool_result"
    custom_tool_use_id: string
    content: Array<{ type: "text"; text: string }>
  }> = []

  if (idle?.type === "session.status_idle" && idle.stop_reason?.type === "requires_action") {
    for (const eid of idle.stop_reason.event_ids) {
      if (eid === toolEventId) continue // handle submit_plan separately below
      const tu = recent.data.find(
        (e) => e.type === "agent.custom_tool_use" && e.id === eid,
      )
      if (tu?.type === "agent.custom_tool_use") {
        let output: string
        try {
          output = await executeCustomTool(
            toolCtx,
            tu.name as CustomToolName,
            tu.input as Record<string, unknown>,
          )
        } catch (e) {
          output = `Error: ${e instanceof Error ? e.message : String(e)}`
        }
        toolResultEvents.push({
          type: "user.custom_tool_result",
          custom_tool_use_id: eid,
          content: [{ type: "text", text: output || "(empty)" }],
        })
      }
    }
  }

  const toolResultText = approved
    ? "Plan approved. Proceed with execution."
    : `Plan rejected. User feedback: ${feedback ?? "No feedback provided"}. Please revise your plan and call submit_plan again.`

  toolResultEvents.push({
    type: "user.custom_tool_result",
    custom_tool_use_id: toolEventId,
    content: [{ type: "text", text: toolResultText }],
  })

  await client.beta.sessions.events.send(sessionId, {
    events: toolResultEvents,
  })

  // After sending the tool result, the agent will continue — stream the response
  after(async () => {
    try {
      await broadcastChatSignal(roomId, chatId, "chat-stream-start")

      const eventStream = await client.beta.sessions.events.stream(sessionId)

      const toolEvents = new Map<
        string,
        { name: string; input: Record<string, unknown> }
      >()

      for await (const event of eventStream) {
        if (event.type === "user.message") continue
        if (event.type === "user.custom_tool_result") continue
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
            const toolName = event.name as string
            const toolInput = event.input as Record<string, unknown>
            toolEvents.set(event.id, { name: toolName, input: toolInput })
            if (toolName !== "submit_plan") {
              await broadcastChatEvent(roomId, chatId, { type: "tool_use", name: toolName, input: toolInput })
            }
            break
          }

          case "session.status_idle": {
            const stopReason = event.stop_reason
            if (stopReason?.type === "requires_action") {
              // Check for submit_plan again (rejection → re-plan flow)
              const planToolEntry = stopReason.event_ids
                .map((eid) => ({ eventId: eid, tool: toolEvents.get(eid) }))
                .find((e) => e.tool?.name === "submit_plan")

              if (planToolEntry?.tool) {
                // Agent re-submitted a plan — handled by the stream route's normal flow
                const { nanoid } = await import("nanoid")
                const planContent = (planToolEntry.tool.input as { plan: string }).plan
                const newPlanId = nanoid()

                await mutateRoomDoc(roomId, ({ plans }) => {
                  plans.set(newPlanId, {
                    id: newPlanId,
                    chatId,
                    agentId: planData!.agentId,
                    content: planContent,
                    status: "pending",
                    toolEventId: planToolEntry.eventId,
                    sessionId,
                    createdAt: Date.now(),
                  })
                })

                await broadcastChatEvent(roomId, chatId, {
                  type: "plan_submitted",
                  planId: newPlanId,
                  plan: planContent,
                  toolEventId: planToolEntry.eventId,
                })
                await broadcastChatSignal(roomId, chatId, "chat-stream-end")
                return
              }

              // Normal tool execution
              const { executeCustomTool } = await import("@/lib/agent/tool-executor")
              for (const eventId of stopReason.event_ids) {
                const toolEvent = toolEvents.get(eventId)
                if (!toolEvent) continue

                let output: string
                try {
                  output = await executeCustomTool(
                    toolCtx,
                    toolEvent.name as import("@/lib/agent/types").CustomToolName,
                    toolEvent.input,
                  )
                } catch (e) {
                  output = `Error: ${e instanceof Error ? e.message : String(e)}`
                }

                await broadcastChatEvent(roomId, chatId, { type: "tool_result", name: toolEvent.name, output })

                await client.beta.sessions.events.send(sessionId, {
                  events: [{
                    type: "user.custom_tool_result",
                    custom_tool_use_id: eventId,
                    content: [{ type: "text", text: output || "(empty)" }],
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

  return Response.json({ success: true })
}
