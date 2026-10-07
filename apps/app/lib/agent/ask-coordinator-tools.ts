import { tool, jsonSchema } from "ai"
import { annotateTools } from "@/lib/mcp/tool-server"

/** The tool a chat hands the Coordinator anything it can't do itself with. */
export const ASK_COORDINATOR_TOOL = "ask_coordinator"

/**
 * What {@link buildAskCoordinatorTools} drives: hand the Coordinator a
 * request from this chat. Resolves once the request is queued, never when the
 * Coordinator's turn ends.
 */
export interface AskCoordinatorPorts {
  ask(request: string): Promise<void>
}

/**
 * Ask the Coordinator (#1843), for every chat: a chat can't change pages,
 * arrange the canvas or start other chats, so it asks the Coordinator in its
 * own words. The Coordinator gets the request as a message from this chat and
 * acts on it with its own tools, after this chat's turn if it's busy.
 */
export function buildAskCoordinatorTools(ports: AskCoordinatorPorts) {
  const tools = {
    [ASK_COORDINATOR_TOOL]: tool({
      description: [
        "Ask the Coordinator to do something you can’t do yourself: create, rename, delete or reorder pages, move layers to another page, arrange or remove things on the canvas, start a new chat, or message another chat.",
        "Write the request in your own words, with the ids and names it needs (from the Canvas view footer, your reads, or the layer directory). The Coordinator gets it as a message from this chat and acts on it with its own tools.",
        "It returns once the request is sent; you don’t hear back in this turn, so carry on with the rest of your work and tell the person you asked the Coordinator.",
      ].join(" "),
      inputSchema: jsonSchema<{ request: string }>({
        type: "object",
        properties: {
          request: {
            type: "string",
            description:
              "What the Coordinator should do, written as the person would ask it.",
          },
        },
        required: ["request"],
      }),
      execute: async ({ request }) => {
        const text = request?.trim()
        if (!text) return "Not sent: the request is empty."
        await ports.ask(text)
        return "Sent to the Coordinator. It acts on it with its own tools; you won’t hear back in this turn."
      },
    }),
  }
  // Starts a Coordinator turn whose own tools carry their own hints.
  return annotateTools(tools, {
    [ASK_COORDINATOR_TOOL]: { destructiveHint: false, openWorldHint: false },
  })
}
