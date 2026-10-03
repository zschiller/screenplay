import { getUserId } from "@/lib/auth-helpers"
import { openRoomForRoute } from "@/lib/room-access"
import { loadCanvasSkills } from "@/lib/skills/canvas"
import { getSkillMenuSource } from "@/lib/skills/sandbox-index"
import type { SkillOrigin } from "@/lib/skills/merged"

/**
 * Origin-tagged skill metadata for the `/` composer menu. With a `sandbox`
 * query param the response includes that Branch's Repo Skills; with a `room`
 * param, that canvas's saved Skills (for a member of it only). They merge
 * with the App Skills ranked Repo, then Canvas, then App, a shadowed row
 * dropped; with neither param the menu is App Skills only.
 */
export interface SkillMenuItem {
  name: string
  description: string
  origin: SkillOrigin
}

export interface SkillsResponse {
  skills: SkillMenuItem[]
}

export const runtime = "nodejs"

export async function GET(request: Request) {
  const userId = await getUserId()
  if (!userId) return new Response("Unauthorized", { status: 401 })

  const params = new URL(request.url).searchParams
  const roomId = params.get("room")
  let canvas: SkillMenuItem[] = []
  if (roomId) {
    const room = await openRoomForRoute(roomId)
    if (room instanceof Response) return room
    canvas = (await loadCanvasSkills(room)).map((s) => ({
      name: s.name,
      description: s.description,
      origin: "canvas",
    }))
  }
  const tagged = await getSkillMenuSource(params.get("sandbox"), canvas)

  const skills: SkillMenuItem[] = tagged.map((s) => ({
    name: s.name,
    description: s.description,
    origin: s.origin,
  }))
  const body: SkillsResponse = { skills }
  return Response.json(body)
}
