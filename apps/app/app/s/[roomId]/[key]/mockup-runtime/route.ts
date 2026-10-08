import { openRoomForViewer } from "@/lib/room-access"

/**
 * The script every Mockup page runs ahead of its own, for a viewer watching
 * the canvas by its link (Sharing, #1932): the host's canvas asks for it with
 * a server action, which the viewer listener refuses.
 * `GET /s/<roomId>/<key>/mockup-runtime`.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ roomId: string; key: string }> }
): Promise<Response> {
  const { roomId, key } = await params
  if (!(await openRoomForViewer(roomId, key))) {
    return new Response("Not found", { status: 404 })
  }
  const { MOCKUP_RUNTIME_JS } = await import("@/lib/sandbox-bridge")
  return new Response(MOCKUP_RUNTIME_JS, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  })
}
