import { openRoomForRoute } from "@/lib/room-access"
import { isLocalBuild } from "@/lib/local-mode"
import { roomChatTarget } from "@/lib/agent/chat-target-kinds"
import {
  COORDINATOR_MCP_SERVER_NAME,
  isAllowedMcpOrigin,
  resolveCoordinatorToken,
} from "@/lib/agent/coordinator-mcp"
import { ROOM_TOOL_ANNOTATIONS } from "@/lib/agent/room-tools"
import { findActiveRun } from "@/lib/agent/persistence"
import { coordinatorTarget } from "@/lib/agent/turn-launch-live"
import { planGateOf } from "@/lib/agent/plan-gate"
import type { ToolSet } from "ai"
import {
  handleMcpMessage,
  parseErrorResponse,
  type McpToolServer,
} from "@/lib/mcp/tool-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * The Coordinator's tools as a Streamable HTTP MCP server, for a Coordinator
 * running on a desktop harness (#903). Local build only: the sidecar listens
 * on 127.0.0.1, and the hosted build has no such surface, so it 404s.
 *
 * Every request needs the bearer token the Coordinator's harness session was
 * given (`coordinator-mcp.ts`); the token, not any tool argument, decides
 * which Room the tools act on. A request from a browser page on any origin
 * but the sidecar's own is refused, as MCP requires of a localhost server.
 *
 * Stateless: each POST carries one JSON-RPC message and gets a JSON answer.
 * There is no server-to-client stream, so GET and DELETE are 405.
 */
export async function POST(req: Request) {
  const refused = refuse(req)
  if (refused) return refused
  const binding = resolveCoordinatorToken(req.headers.get("authorization"))
  if (!binding) return new Response("Unauthorized", { status: 401 })

  let message: unknown
  try {
    message = await req.json()
  } catch {
    return Response.json(parseErrorResponse(), { status: 400 })
  }

  const room = await openRoomForRoute(binding.roomId, binding.chatId)
  if (room instanceof Response) return room
  // Each request builds a fresh tool set, so log canvas changes under the
  // Coordinator's running turn: "undo that" then undoes the whole reply.
  const run = await findActiveRun(binding.chatId).catch(() => null)

  const server: McpToolServer = {
    name: COORDINATOR_MCP_SERVER_NAME,
    version: "1",
    tools: withoutPlanGates(
      roomChatTarget.buildTools(
        room,
        coordinatorTarget(room, binding.chatId, { turnId: run?.id })
      )
    ),
    annotations: ROOM_TOOL_ANNOTATIONS,
    // A wrong URL or token only ever shows up as "the tools aren't there", so
    // log each handshake to tell a missing one apart.
    onInitialize: (client) =>
      console.info(
        `[coordinator-mcp] ${client.name ?? "client"} connected for room ${binding.roomId}`
      ),
  }
  const response = await handleMcpMessage(server, message)
  if (!response) return new Response(null, { status: 202 })
  return Response.json(response)
}

export async function GET(req: Request) {
  return refuse(req) ?? methodNotAllowed()
}

export async function DELETE(req: Request) {
  return refuse(req) ?? methodNotAllowed()
}

function refuse(req: Request): Response | null {
  if (!isLocalBuild) return new Response("Not found", { status: 404 })
  if (!isAllowedMcpOrigin(req.headers.get("origin"))) {
    return new Response("Forbidden origin", { status: 403 })
  }
  return null
}

function methodNotAllowed(): Response {
  return new Response("Method not allowed", {
    status: 405,
    headers: { Allow: "POST" },
  })
}

/**
 * A plan-gated tool (`create_workspaces`, #898) needs Screenplay's plan review,
 * which only the built-in engine raises: a harness runs MCP tools itself and
 * never halts on our approval card. Over MCP it says so instead, so the
 * Coordinator can tell the user rather than retrying.
 */
function withoutPlanGates(tools: ToolSet): ToolSet {
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    out[name] = planGateOf(t)
      ? {
          ...t,
          execute: async () => {
            throw new Error(
              "Creating Workspaces needs the user to approve a plan, which this harness can't show yet. Tell the user to create them from the canvas, or to switch the Coordinator's model to a built-in one."
            )
          },
        }
      : t
  }
  return out
}
