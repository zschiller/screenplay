import { getUserId } from "@/lib/auth-helpers"
import { getClient } from "@/lib/agent/config"
import type { AgentMessage, CustomToolName } from "@/lib/agent/types"

export const runtime = "nodejs"

export async function GET(req: Request) {
  const userId = await getUserId()
  if (!userId) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get("sessionId")

  if (!sessionId) {
    return Response.json([])
  }

  const client = getClient()

  try {
    const events = await client.beta.sessions.events.list(sessionId)

    const messages: AgentMessage[] = []

    // Track submit_plan tool use IDs so we can determine status from tool results
    const planToolUseIds = new Set<string>()

    for (const event of events.data) {
      switch (event.type) {
        case "user.message": {
          for (const block of event.content) {
            if ("text" in block) {
              messages.push({ role: "user", content: block.text })
            }
          }
          break
        }
        case "agent.message": {
          let text = ""
          for (const block of event.content) {
            if ("text" in block) {
              text += block.text
            }
          }
          if (text) {
            messages.push({ role: "assistant", content: text })
          }
          break
        }
        case "agent.custom_tool_use": {
          if (event.name === "submit_plan") {
            const input = event.input as { plan: string }
            planToolUseIds.add(event.id)
            // Determine plan status by looking ahead for the tool result
            const toolResult = events.data.find(
              (e) => e.type === "user.custom_tool_result" && e.custom_tool_use_id === event.id,
            )
            let status: "pending" | "approved" | "rejected" = "pending"
            if (toolResult && toolResult.type === "user.custom_tool_result") {
              const resultText = toolResult.content
                ?.map((b) => ("text" in b ? b.text : ""))
                .join("") ?? ""
              if (resultText.includes("Plan approved")) {
                status = "approved"
              } else if (resultText.includes("Plan rejected")) {
                status = "rejected"
              }
            }
            messages.push({
              role: "plan",
              content: input.plan,
              status,
              planId: event.id,
            })
          } else {
            messages.push({
              role: "tool_use",
              name: event.name as CustomToolName,
              input: event.input as Record<string, unknown>,
            })
          }
          break
        }
        case "user.custom_tool_result": {
          // Skip tool results for submit_plan — already handled inline
          if (planToolUseIds.has(event.custom_tool_use_id ?? "")) break

          // Extract tool name from the corresponding tool_use if possible
          let toolName: CustomToolName = "run_command"
          let output = ""
          for (const block of event.content ?? []) {
            if ("text" in block) {
              output += block.text
            }
          }
          // Try to find the matching tool_use by ID to get the name
          const toolUseId = event.custom_tool_use_id
          if (toolUseId) {
            const matchingToolUse = events.data.find(
              (e) => e.type === "agent.custom_tool_use" && e.id === toolUseId,
            )
            if (matchingToolUse && matchingToolUse.type === "agent.custom_tool_use") {
              toolName = matchingToolUse.name as CustomToolName
            }
          }
          messages.push({ role: "tool_result", name: toolName, output })
          break
        }
      }
    }

    return Response.json(messages)
  } catch {
    // Session may not exist anymore
    return Response.json([])
  }
}
