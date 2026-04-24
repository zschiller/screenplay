import { after } from "next/server"
import { nanoid } from "nanoid"
import { getGitHubTokenForUser, getUserId } from "@/lib/auth-helpers"
import { LiveObject } from "@liveblocks/client"
import { getClient, getOrCreateAgent, getOrCreateEnvironment } from "@/lib/agent/config"
import { executeCustomTool, type ToolContext } from "@/lib/agent/tool-executor"
import type { CustomToolName, AgentStreamEvent } from "@/lib/agent/types"
import type { PlanData } from "@/lib/liveblocks.types"
import { liveblocks } from "@/lib/liveblocks-server"
import { kv } from "@/lib/kv"

export const runtime = "nodejs"
export const maxDuration = 300

interface RequestBody {
  roomId: string
  chatId: string
  sandboxName: string
  branch: string
  message: string
  sessionId?: string
  isFirstChat?: boolean
  autoNamedBranch?: boolean
  planMode?: boolean
  model?: string
}

/**
 * Ensure a branch name doesn't collide with an existing remote branch.
 * If it does, append -2, -3, etc. until a unique name is found.
 */
async function deduplicateBranchName(
  roomId: string,
  branchName: string,
  userId: string,
): Promise<string> {
  try {
    // Read repo info from Liveblocks room storage
    const storage = await liveblocks.getStorageDocument(roomId, "json") as Record<string, unknown>
    const workspace = storage.workspace as { repoOwner?: string; repoName?: string } | undefined
    if (!workspace?.repoOwner || !workspace?.repoName) return branchName

    const token = await getGitHubTokenForUser(userId)
    if (!token) return branchName

    const { repoOwner, repoName } = workspace
    let candidate = branchName
    let suffix = 2

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await fetch(
        `https://api.github.com/repos/${repoOwner}/${repoName}/git/ref/heads/${candidate}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } },
      )
      if (res.status === 404) break // branch doesn't exist, we're good
      if (!res.ok) break // unexpected error, just use the name as-is
      candidate = `${branchName}-${suffix}`
      suffix++
      if (suffix > 10) break // safety valve
    }

    return candidate
  } catch (e) {
    console.error("Branch deduplication failed:", e)
    return branchName
  }
}

/**
 * Check the Anthropic session directly for a pending submit_plan tool call.
 * Returns the event ID if found, null otherwise.
 */
async function findPendingSubmitPlan(
  client: ReturnType<typeof getClient>,
  sessionId: string,
): Promise<{
  submitPlanEventId: string
  otherPendingEvents: Array<{ id: string; name: string; input: Record<string, unknown> }>
} | null> {
  try {
    const session = await client.beta.sessions.retrieve(sessionId)
    if (session.status !== "idle") return null

    const recent = await client.beta.sessions.events.list(sessionId, {
      limit: 50,
      order: "desc",
    })
    const idle = recent.data.find((e) => e.type === "session.status_idle")
    if (
      idle?.type !== "session.status_idle" ||
      idle.stop_reason?.type !== "requires_action"
    ) return null

    let submitPlanEventId: string | null = null
    const otherPendingEvents: Array<{ id: string; name: string; input: Record<string, unknown> }> = []

    for (const eid of idle.stop_reason.event_ids) {
      const tu = recent.data.find(
        (e) => e.type === "agent.custom_tool_use" && e.id === eid,
      )
      if (tu?.type === "agent.custom_tool_use") {
        if (tu.name === "submit_plan") {
          submitPlanEventId = eid
        } else {
          otherPendingEvents.push({
            id: eid,
            name: tu.name,
            input: tu.input as Record<string, unknown>,
          })
        }
      }
    }

    if (submitPlanEventId) {
      return { submitPlanEventId, otherPendingEvents }
    }
  } catch (e) {
    console.error("findPendingSubmitPlan error:", e)
  }
  return null
}

/**
 * Find a pending plan for a given session in Liveblocks storage.
 */
async function findPendingPlan(roomId: string, sessionId: string): Promise<PlanData | null> {
  const ref: { data: PlanData | null } = { data: null }
  try {
    await liveblocks.mutateStorage(roomId, ({ root }) => {
      const plansMap = root.get("plans")
      if (!plansMap) return
      plansMap.forEach((plan) => {
        if (plan.get("sessionId") === sessionId && plan.get("status") === "pending") {
          ref.data = {
            id: plan.get("id"),
            chatId: plan.get("chatId"),
            agentId: plan.get("agentId"),
            content: plan.get("content"),
            status: plan.get("status"),
            toolEventId: plan.get("toolEventId"),
            sessionId: plan.get("sessionId"),
            feedback: plan.get("feedback"),
            createdAt: plan.get("createdAt"),
            resolvedAt: plan.get("resolvedAt"),
          }
        }
      })
    })
  } catch (e) {
    console.error("findPendingPlan error:", e)
  }
  return ref.data
}

/**
 * Safety net: resolve stuck tool calls if the handler died mid-execution.
 */
async function resolveStuckToolCalls(sessionId: string, ctx: ToolContext) {
  const lockKey = `session-recover:${sessionId}`
  const locked = await kv.set(lockKey, "1", { nx: true, ex: 120 })
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
      // Skip submit_plan — those are intentionally pending for user approval
      if (tu?.type === "agent.custom_tool_use" && tu.name === "submit_plan") continue

      let output = "Tool execution was interrupted."
      if (tu?.type === "agent.custom_tool_use") {
        try {
          output = await executeCustomTool(
            ctx,
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
          content: [{ type: "text", text: output || "(empty)" }],
        }],
      })
    }
  } finally {
    await kv.del(lockKey)
  }
}

/**
 * Ensure a session is in idle+end_turn state before sending a new message.
 */
async function ensureSessionReady(
  client: ReturnType<typeof getClient>,
  sessionId: string,
  ctx: ToolContext,
) {
  // Retry loop: resolve pending tools until session is ready for a user message
  for (let attempt = 0; attempt < 5; attempt++) {
    const session = await client.beta.sessions.retrieve(sessionId)

    if (session.status === "terminated") {
      throw new Error("Session terminated")
    }

    if (session.status === "running") {
      await waitForIdle(client, sessionId)
      continue
    }

    if (session.status === "idle") {
      // Check if session is actually ready (end_turn) vs waiting for tool results
      const recent = await client.beta.sessions.events.list(sessionId, {
        limit: 50,
        order: "desc",
      })
      const idle = recent.data.find((e) => e.type === "session.status_idle")
      if (
        idle?.type === "session.status_idle" &&
        idle.stop_reason?.type === "requires_action"
      ) {
        // Session is waiting for tool results — resolve them directly
        for (const eid of idle.stop_reason.event_ids) {
          const tu = recent.data.find(
            (e) => e.type === "agent.custom_tool_use" && e.id === eid,
          )
          if (!tu || tu.type !== "agent.custom_tool_use") continue

          let output = "Tool execution was interrupted."
          try {
            output = await executeCustomTool(
              ctx,
              tu.name as CustomToolName,
              tu.input as Record<string, unknown>,
            )
          } catch (e) {
            output = `Error: ${e instanceof Error ? e.message : String(e)}`
          }
          await client.beta.sessions.events.send(sessionId, {
            events: [{
              type: "user.custom_tool_result",
              custom_tool_use_id: eid,
              content: [{ type: "text", text: output || "(empty)" }],
            }],
          })
        }
        // After resolving, the session may start running again — loop to wait
        continue
      }
      // Session is idle with end_turn — ready for a new message
      return
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

function deriveFallbackLabel(message: string): string {
  const cleaned = message.replace(/\s+/g, " ").trim()
  if (!cleaned) return ""
  const words = cleaned.split(" ").slice(0, 6).join(" ")
  const truncated = words.length > 50 ? `${words.slice(0, 50).trimEnd()}…` : words
  return truncated
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
  const userId = await getUserId()
  if (!userId) {
    return new Response("Unauthorized", { status: 401 })
  }

  const body: RequestBody = await req.json()
  const { roomId, chatId, sandboxName, branch, message, sessionId: existingSessionId, isFirstChat, autoNamedBranch, planMode, model } = body

  if (!roomId || !chatId || !sandboxName || !message) {
    return new Response("Missing required fields", { status: 400 })
  }

  const toolCtx: ToolContext = { sandboxName, roomId, userId }

  const client = getClient()

  // Resolve agent + environment up front. Model only affects new sessions —
  // existing sessions stay bound to whichever agent/model they were created with.
  const [agentId, environmentId] = await Promise.all([
    getOrCreateAgent(model),
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
    // Check Anthropic session directly for a pending submit_plan tool call
    const pendingSubmitPlan = await findPendingSubmitPlan(client, sessionId)
    if (pendingSubmitPlan) {
      // Try to update plan status in Liveblocks storage
      const pendingPlan = await findPendingPlan(roomId, sessionId)
      if (pendingPlan) {
        await liveblocks.mutateStorage(roomId, ({ root }) => {
          const plan = root.get("plans")?.get(pendingPlan.id)
          if (plan) {
            plan.set("status", "rejected")
            plan.set("resolvedAt", Date.now())
            plan.set("feedback", message)
          }
        })
        await broadcastChatEvent(roomId, chatId, { type: "plan_rejected", planId: pendingPlan.id, feedback: message })
      }

      await broadcastChatSignal(roomId, chatId, "chat-stream-start")
      await broadcastChatEvent(roomId, chatId, { type: "user_message", text: message })

      // Resolve ALL pending tool calls — the session won't accept anything until all are resolved
      // First, execute any other pending tools (read_file, list_files, etc.)
      const toolResultEvents: Array<{
        type: "user.custom_tool_result"
        custom_tool_use_id: string
        content: Array<{ type: "text"; text: string }>
      }> = []

      for (const pending of pendingSubmitPlan.otherPendingEvents) {
        let output: string
        try {
          output = await executeCustomTool(
            toolCtx,
            pending.name as CustomToolName,
            pending.input,
          )
        } catch (e) {
          output = `Error: ${e instanceof Error ? e.message : String(e)}`
        }
        toolResultEvents.push({
          type: "user.custom_tool_result",
          custom_tool_use_id: pending.id,
          content: [{ type: "text", text: output || "(empty)" }],
        })
      }

      // Add the submit_plan result last
      const toolResultText = `Plan rejected. User feedback: ${message}. Please revise your plan and call submit_plan again.`
      toolResultEvents.push({
        type: "user.custom_tool_result",
        custom_tool_use_id: pendingSubmitPlan.submitPlanEventId,
        content: [{ type: "text", text: toolResultText }],
      })

      await client.beta.sessions.events.send(sessionId, {
        events: toolResultEvents,
      })

      // Stream the agent's continued response in the background
      const planSessionId = sessionId
      const planAgentId = sandboxName
      after(async () => {
        try {
          const eventStream = await client.beta.sessions.events.stream(planSessionId)
          const planToolEvents = new Map<string, { name: string; input: Record<string, unknown> }>()

          for await (const event of eventStream) {
            if (event.type === "user.message") continue
            if (event.type === "user.custom_tool_result") continue
            if (event.type === "session.status_running") continue

            switch (event.type) {
              case "agent.message": {
                let text = ""
                for (const block of event.content) {
                  if ("text" in block) text += block.text
                }
                if (text) await broadcastChatEvent(roomId, chatId, { type: "text", text })
                break
              }
              case "agent.custom_tool_use": {
                const toolName = event.name as string
                const toolInput = event.input as Record<string, unknown>
                planToolEvents.set(event.id, { name: toolName, input: toolInput })
                if (toolName !== "submit_plan") {
                  await broadcastChatEvent(roomId, chatId, { type: "tool_use", name: toolName, input: toolInput })
                }
                break
              }
              case "session.status_idle": {
                const stopReason = event.stop_reason
                if (stopReason?.type === "requires_action") {
                  const planTool = stopReason.event_ids
                    .map((eid) => ({ eventId: eid, tool: planToolEvents.get(eid) }))
                    .find((e) => e.tool?.name === "submit_plan")

                  if (planTool?.tool) {
                    const planContent = (planTool.tool.input as { plan: string }).plan
                    const newPlanId = nanoid()
                    await liveblocks.mutateStorage(roomId, ({ root }) => {
                      root.get("plans").set(newPlanId, new LiveObject<PlanData>({
                        id: newPlanId,
                        chatId,
                        agentId: planAgentId,
                        content: planContent,
                        status: "pending",
                        toolEventId: planTool.eventId,
                        sessionId: planSessionId,
                        createdAt: Date.now(),
                      }))
                    })
                    await broadcastChatEvent(roomId, chatId, {
                      type: "plan_submitted", planId: newPlanId, plan: planContent, toolEventId: planTool.eventId,
                    })
                    await broadcastChatSignal(roomId, chatId, "chat-stream-end")
                    return
                  }

                  for (const eventId of stopReason.event_ids) {
                    const toolEvent = planToolEvents.get(eventId)
                    if (!toolEvent) continue
                    let output: string
                    try {
                      output = await executeCustomTool(toolCtx, toolEvent.name as CustomToolName, toolEvent.input)
                    } catch (e) {
                      output = `Error: ${e instanceof Error ? e.message : String(e)}`
                    }
                    await broadcastChatEvent(roomId, chatId, { type: "tool_result", name: toolEvent.name, output })
                    await client.beta.sessions.events.send(planSessionId, {
                      events: [{ type: "user.custom_tool_result", custom_tool_use_id: eventId, content: [{ type: "text", text: output || "(empty)" }] }],
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
                  message: (event as { error?: { message?: string } }).error?.message ?? "Unknown agent error",
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
          await broadcastChatEvent(roomId, chatId, { type: "error", message: e instanceof Error ? e.message : String(e) })
          await broadcastChatEvent(roomId, chatId, { type: "done" })
          await broadcastChatSignal(roomId, chatId, "chat-stream-end")
        }
      })

      return Response.json({ sessionId })
    }

    await ensureSessionReady(client, sessionId, toolCtx)
  }

  // Broadcast session_id to all clients immediately
  broadcastChatEvent(roomId, chatId, { type: "session_id", sessionId })

  // For every new chat session, generate a chat label (and a branch name on
  // the first chat for the agent).
  let effectiveBranch = branch
  if (!existingSessionId) {
    const shouldNameBranch = isFirstChat !== false && autoNamedBranch !== false
    let rawBranch = ""
    let chatLabel = ""
    try {
      const system = shouldNameBranch
        ? "Generate two things for the user's request:\n1. A short, lowercase, hyphenated git branch name (2-4 words)\n2. A short chat label (2-5 words, title case)\n\nOutput ONLY as two lines, no explanation, backticks, or quotes.\nLine 1: branch name\nLine 2: chat label\n\nExamples:\nfix-login-button\nFix Login Button\n\nadd-dark-mode\nAdd Dark Mode"
        : "Generate a short chat label for the user's request (2-5 words, title case). Output ONLY the label — no explanation, backticks, or quotes.\n\nExamples:\nFix Login Button\nAdd Dark Mode"
      const nameRes = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 200,
        system,
        messages: [{ role: "user", content: message }],
      })
      const rawText = nameRes.content[0]?.type === "text" ? nameRes.content[0].text.trim() : ""
      const lines = rawText
        .split("\n")
        .map((l) => l.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/^[-*\d.)\s]+/, "").trim())
        .filter(Boolean)

      if (shouldNameBranch) {
        rawBranch = (lines[0] ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
        chatLabel = (lines[1] ?? "").replace(/^["'`]+|["'`]+$/g, "").trim()
      } else {
        chatLabel = (lines[0] ?? "").replace(/^["'`]+|["'`]+$/g, "").trim()
      }
    } catch (e) {
      console.error("Branch/chat rename generation failed:", e)
    }

    if (shouldNameBranch && rawBranch.length >= 3 && rawBranch.length <= 50) {
      effectiveBranch = await deduplicateBranchName(roomId, rawBranch, userId)
      await broadcastChatEvent(roomId, chatId, { type: "branch_rename", branch: effectiveBranch })
    }

    const finalLabel =
      chatLabel.length >= 2 && chatLabel.length <= 60 ? chatLabel : deriveFallbackLabel(message)
    if (finalLabel) {
      // Persist the label directly in Liveblocks storage so it survives
      // even if the client-side callback is temporarily cleared during a
      // React re-render triggered by the earlier session_id broadcast.
      await liveblocks.mutateStorage(roomId, ({ root }) => {
        const cs = root.get("chatSessions")?.get(chatId)
        if (cs) cs.set("label", finalLabel)
      })
      await broadcastChatEvent(roomId, chatId, { type: "chat_rename", label: finalLabel })
    }
  }

  // Return the session ID immediately — streaming happens in the background
  const responseSessionId = sessionId

  // Run the actual agent streaming in the background via next/server `after`
  after(async () => {
    try {
      await broadcastChatSignal(roomId, chatId, "chat-stream-start")
      await broadcastChatEvent(roomId, chatId, { type: "user_message", text: message })

      const planPrefix = planMode ? "[plan mode: enabled] " : ""
      const branchPrefix = !existingSessionId && effectiveBranch ? `[branch: ${effectiveBranch}] ` : ""
      const userText = `${planPrefix}${branchPrefix}${message}`

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
            // Don't broadcast submit_plan as a tool_use — it gets its own plan_submitted event
            if (toolName !== "submit_plan") {
              await broadcastChatEvent(roomId, chatId, { type: "tool_use", name: toolName, input: toolInput })
            }
            break
          }

          case "session.status_idle": {
            const stopReason = event.stop_reason
            if (stopReason?.type === "requires_action") {
              // Check if any pending tool is submit_plan — if so, pause for user approval
              const planToolEntry = stopReason.event_ids
                .map((eid) => ({ eventId: eid, tool: toolEvents.get(eid) }))
                .find((e) => e.tool?.name === "submit_plan")

              if (planToolEntry?.tool) {
                const planContent = (planToolEntry.tool.input as { plan: string }).plan
                const planId = nanoid()

                // Persist plan in Liveblocks storage
                await liveblocks.mutateStorage(roomId, ({ root }) => {
                  const plansMap = root.get("plans")
                  plansMap.set(planId, new LiveObject<PlanData>({
                    id: planId,
                    chatId,
                    agentId: sandboxName,
                    content: planContent,
                    status: "pending",
                    toolEventId: planToolEntry.eventId,
                    sessionId: sessionId!,
                    createdAt: Date.now(),
                  }))
                })

                // Broadcast plan to all clients and stop processing — approval endpoint will resume
                await broadcastChatEvent(roomId, chatId, {
                  type: "plan_submitted",
                  planId,
                  plan: planContent,
                  toolEventId: planToolEntry.eventId,
                })
                await broadcastChatSignal(roomId, chatId, "chat-stream-end")
                return
              }

              // Normal tool execution for non-plan tools
              for (const eventId of stopReason.event_ids) {
                const toolEvent = toolEvents.get(eventId)
                if (!toolEvent) continue

                let output: string
                try {
                  output = await executeCustomTool(
                    toolCtx,
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

  // Safety net for stuck tool calls
  after(() => resolveStuckToolCalls(responseSessionId, toolCtx))

  return Response.json({ sessionId: responseSessionId })
}
