import { MAX_MOCKUP_REFS, type MockupResources } from "@/lib/mockup-refs"
import { mockupRefSources, resolveMockupRefs } from "@/lib/mockup-refs-server"
import { openRoomForRoute } from "@/lib/room-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export interface MockupRefsResponse {
  resources: MockupResources
}

/**
 * Resolves a Mockup page's `skill:` and `files:` references (#1643) for a
 * member of its canvas, and nobody else: each as its media type and base64
 * bytes, or `null` when it doesn't resolve. Skills resolve as that member's
 * chats see them. `POST /api/mockup-refs/<roomId>` with
 * `{ mockupId, refs }`.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> }
): Promise<Response> {
  const { roomId } = await params
  const room = await openRoomForRoute(roomId)
  if (room instanceof Response) return room

  const body = (await req.json().catch(() => null)) as {
    mockupId?: unknown
    refs?: unknown
  } | null
  const refs = body?.refs
  if (
    typeof body?.mockupId !== "string" ||
    !Array.isArray(refs) ||
    refs.length > MAX_MOCKUP_REFS ||
    !refs.every((r) => typeof r === "string")
  ) {
    return new Response("Bad request", { status: 400 })
  }
  const sources = await mockupRefSources(room, {
    mockupId: body.mockupId,
    userId: room.userId,
  })
  const result: MockupRefsResponse = {
    resources: await resolveMockupRefs(refs as string[], sources),
  }
  return Response.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  })
}
