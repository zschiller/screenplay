import { openRoomForRoute } from "@/lib/room-access"
import { buildIdentity } from "@/lib/capabilities"
import {
  COORDINATOR_MCP_SERVER_NAME,
  isAllowedMcpOrigin,
  resolveCoordinatorToken,
} from "@/lib/agent/coordinator-mcp"
import { findActiveRun, getChatModel } from "@/lib/agent/persistence"
import { turnHarnessKey } from "@/lib/agent/acp/engine-choice"
import { coordinatorTarget } from "@/lib/agent/turn-launch-live"
import { roomChatTarget } from "@/lib/agent/room-chat-target"
import { sketchChatTarget } from "@/lib/agent/sketch-chat-target"
import { workspaceChatTarget } from "@/lib/agent/workspace-chat-target"
import { toolsetOn, withRedactedOutput } from "@/lib/agent/toolset"
import { sandboxSecrets } from "@/lib/env-store"
import { handleMcpMessage, parseErrorResponse } from "@/lib/mcp/tool-server"
import type { ToolSet } from "ai"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * The Coordinator's tools as a Streamable HTTP MCP server, for a Coordinator
 * running on a desktop harness (#903). A Workspace chat on a harness reaches
 * its dev server's tools (log, restart) and its Document tools (#1314) through
 * the same route. Local build only: the sidecar listens
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
  // The chat's Harness, whose own Skills `read_skill` reads (#1560).
  const harnessKey = turnHarnessKey(
    (await getChatModel(binding.chatId).catch(() => null)) ?? undefined
  )

  // A token minted for a turn nobody sent gets no account memory (#1515).
  const senderless = binding.senderless ? { senderless: true } : {}

  // Each binding gets its Chat Target's toolset on a harness: the tools its
  // in-process turn has, less the file, shell and plan tools the harness
  // brings its own of (#1487).
  const serve = async (tools: ToolSet, connected: string) => {
    const response = await handleMcpMessage(
      {
        name: COORDINATOR_MCP_SERVER_NAME,
        version: "1",
        tools,
        // A wrong URL or token only ever shows up as "the tools aren't
        // there", so log each handshake to tell a missing one apart.
        onInitialize: (client) =>
          console.info(`${client.name ?? "client"} connected for ${connected}`),
      },
      message
    )
    if (!response) return new Response(null, { status: 202 })
    return Response.json(response)
  }

  // A Workspace chat's tools are bound to the Sandbox its token was minted
  // for and to its chat. Output is scrubbed of the Sandbox's env var values,
  // as on the in-process engine (#1416).
  if (binding.sandboxName) {
    const tools = workspaceChatTarget.tools(room, {
      sandboxName: binding.sandboxName,
      chatId: binding.chatId,
      userId: room.userId,
      ...senderless,
      harnessKey,
    })
    return serve(
      withRedactedOutput(
        toolsetOn(tools, "harness"),
        await sandboxSecrets(binding.sandboxName)
      ),
      `[workspace-mcp] ${binding.sandboxName}`
    )
  }
  if (binding.sketch) {
    const tools = sketchChatTarget.tools(room, {
      chatId: binding.chatId,
      userId: room.userId,
      ...senderless,
      harnessKey,
    })
    return serve(
      toolsetOn(tools, "harness"),
      `[sketch-mcp] chat ${binding.chatId}`
    )
  }
  // Each request builds a fresh tool set, so log canvas changes under the
  // Coordinator's running turn: "undo that" then undoes the whole reply.
  const run = await findActiveRun(binding.chatId).catch(() => null)
  const tools = roomChatTarget.tools(
    room,
    coordinatorTarget(room, binding.chatId, {
      turnId: run?.id,
      ...senderless,
      harnessKey,
    })
  )
  return serve(
    toolsetOn(tools, "harness"),
    `[coordinator-mcp] room ${binding.roomId}`
  )
}

export async function GET(req: Request) {
  return refuse(req) ?? methodNotAllowed()
}

export async function DELETE(req: Request) {
  return refuse(req) ?? methodNotAllowed()
}

function refuse(req: Request): Response | null {
  if (buildIdentity === "account")
    return new Response("Not found", { status: 404 })
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
