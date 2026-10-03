import { openRoomForRoute } from "@/lib/room-access"
import { isLocalSandboxBackend } from "@/lib/sandbox/backend"
import {
  ensureFrameStream,
  sharedFramesEnabled,
} from "@/lib/sandbox/frame-stream"
import { frameStreamKey, viewToken } from "@/lib/frame-stream/token"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Where a Canvas member watches a Workspace's shared frames (#1392): ensure
 * its Frame Stream service, then hand back the stream URL and a short-lived
 * view token the client sends as its first message. `{ shared: false }` keeps
 * the Workspace's frames as per-viewer iframes: the desktop app, a deployment
 * with `SHARED_FRAMES=off`, or a Sandbox created before the stream port.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    room?: unknown
    branchId?: unknown
  }
  const roomId = typeof body.room === "string" ? body.room : ""
  const branchId = typeof body.branchId === "string" ? body.branchId : ""
  if (!roomId || !branchId) {
    return Response.json(
      { error: "room and branchId are required" },
      { status: 400 }
    )
  }

  const room = await openRoomForRoute(roomId)
  if (room instanceof Response) return room

  if (isLocalSandboxBackend() || !sharedFramesEnabled()) {
    return Response.json({ shared: false })
  }

  const branch = await room.readDoc((c) => c.branches.get(branchId))
  if (!branch) {
    return Response.json({ error: "No such Workspace" }, { status: 404 })
  }

  const result = await ensureFrameStream(branch.sandboxName, branch.port)
  if (!result.success) {
    return Response.json({ error: result.error }, { status: 502 })
  }
  if (!result.value) return Response.json({ shared: false })

  const { token, expiresAt } = viewToken(
    frameStreamKey(branch.sandboxName),
    room.userId
  )
  return Response.json({
    shared: true,
    url: result.value.url,
    token,
    expiresAt,
  })
}
