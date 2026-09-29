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
  buildDevServerTools,
  DEV_SERVER_TOOL_ANNOTATIONS,
} from "@/lib/agent/dev-server-tools"
import { liveDevServerPorts } from "@/lib/agent/dev-server-ports"
import { withRedactedOutput } from "@/lib/agent/toolset"
import {
  handleMcpMessage,
  parseErrorResponse,
  type McpToolServer,
} from "@/lib/mcp/tool-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * The Coordinator's tools as a Streamable HTTP MCP server, for a Coordinator
 * running on a desktop harness (#903). A Workspace chat on a harness reaches
 * its dev server's tools (log, restart) through the same route. Local build only: the sidecar listens
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

  // A Workspace chat's harness gets its own dev server's tools, bound to the
  // Sandbox its token was minted for.
  if (binding.sandboxName) {
    const response = await handleMcpMessage(
      {
        name: COORDINATOR_MCP_SERVER_NAME,
        version: "1",
        tools: withRedactedOutput(
          buildDevServerTools(
            liveDevServerPorts({ sandboxName: binding.sandboxName, room })
          )
        ),
        annotations: DEV_SERVER_TOOL_ANNOTATIONS,
        onInitialize: (client) =>
          console.info(
            `[workspace-mcp] ${client.name ?? "client"} connected for ${binding.sandboxName}`
          ),
      },
      message
    )
    if (!response) return new Response(null, { status: 202 })
    return Response.json(response)
  }
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
 * A plan-gated tool (`create_workspaces`, #898; `open_pull_request` and
 * `remove_workspace`, #901) needs Screenplay's plan review or confirm card,
 * which only the built-in engine raises: a harness runs MCP tools itself and
 * never halts on our card, and a harness permission prompt doesn't count as
 * the user's confirm. Over MCP it says so instead, so the Coordinator can tell
 * the user rather than retrying.
 */
function withoutPlanGates(tools: ToolSet): ToolSet {
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    out[name] = planGateOf(t)
      ? {
          ...t,
          execute: async () => {
            throw new Error(harnessGateRefusal(name))
          },
        }
      : t
  }
  return out
}

const GATED_ACTIONS: Record<string, { needs: string; instead: string }> = {
  create_workspaces: {
    needs: "Creating Workspaces needs the user to approve a plan",
    instead: "create them from the canvas",
  },
  open_pull_request: {
    needs: "Opening a pull request needs the user to confirm it",
    instead: "open it from the Workspace's menu",
  },
  remove_workspace: {
    needs: "Removing a Workspace needs the user to confirm it",
    instead: "delete it from the sidebar",
  },
}

function harnessGateRefusal(tool: string): string {
  const action = GATED_ACTIONS[tool] ?? {
    needs: "This needs the user's approval",
    instead: "do it from the canvas",
  }
  return `${action.needs}, which this harness can't show yet. Tell the user to ${action.instead}, or to switch the Coordinator's model to a built-in one.`
}
