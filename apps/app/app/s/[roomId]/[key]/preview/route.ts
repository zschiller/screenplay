import { probeWorkspacePreview } from "@/lib/sandbox/lifecycle"
import { openRoomForViewer } from "@/lib/room-access"
import { viewerPreview } from "@/lib/viewer/preview"
import { getSharing } from "@/server/sharing.mjs"

/**
 * Where a viewer's frame loads a Workspace's preview, and whether it answers
 * yet (Sharing, #1932): `?sandbox=<name>&port=<dev port>`, for a preview a
 * frame on the canvas shows. The viewer's stand-in for the host's preview
 * probe, which is a server action the viewer listener refuses.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string; key: string }> }
) {
  const sharing = getSharing()
  if (!sharing) return new Response("Not found", { status: 404 })
  const { roomId, key } = await params
  const room = await openRoomForViewer(roomId, key)
  if (!room) return new Response("Not found", { status: 404 })
  const search = new URL(request.url).searchParams
  const sandboxName = search.get("sandbox")
  const devPort = Number(search.get("port"))
  if (!sandboxName || !Number.isInteger(devPort)) {
    return new Response("Not found", { status: 404 })
  }
  // Every Workspace on the canvas, as the preview its frames show.
  const frames = await room.readDoc((c) =>
    c.branches.toArray().map((branch) => ({
      iframeUrl: branch.previewDomain,
      workspace: { sandboxName: branch.sandboxName, devPort: branch.port },
    }))
  )
  const preview = await viewerPreview({
    frames,
    sandboxName,
    devPort,
    // Through Sharing, so turning it off releases every port a viewer's
    // frame exposed (#1953).
    expose: (port) => sharing.expose(port),
    probe: probeWorkspacePreview,
  }).catch((err: unknown) => {
    console.warn(
      `[viewers] couldn’t expose a preview: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  })
  if (!preview) return new Response("Not found", { status: 404 })
  return Response.json(preview, { headers: { "Cache-Control": "no-store" } })
}
