import { auth } from "@clerk/nextjs/server"
import { getClient } from "@/lib/agent/config"
import type { AgentMessage, CustomToolName } from "@/lib/agent/types"

export const runtime = "nodejs"

export async function GET(req: Request) {
  const { userId } = await auth()
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
          messages.push({
            role: "tool_use",
            name: event.name as CustomToolName,
            input: event.input as Record<string, unknown>,
          })
          break
        }
        case "user.custom_tool_result": {
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
