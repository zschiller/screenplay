import { sketchSkillIndex } from "@/lib/agent/sketch-tools"
import { getUserId } from "@/lib/auth-helpers"
import { openRoomForRoute } from "@/lib/room-access"
import { getSkillIndex } from "@/lib/skills"
import { loadCanvasSkills } from "@/lib/skills/canvas"
import { mergeSkillIndexes, type SkillOrigin } from "@/lib/skills/merged"
import { getSkillMenuSource } from "@/lib/skills/sandbox-index"

/**
 * Origin-tagged skill metadata for the `/` composer menu. With a `sandbox`
 * query param the response includes that Branch's Repo Skills; with a `room`
 * param, that canvas's saved Skills (for a member of it only). They merge
 * with the App Skills ranked Repo, then Canvas, then App, a shadowed row
 * dropped; with neither param the menu is App Skills only.
 *
 * A `chat` param names a chat with no Branch (#1556): `room` (the
 * Coordinator) lists the canvas's and the Coordinator's App Skills, `sketch`
 * the canvas's and the Mockup App Skills, each what that chat's `read_skill`
 * reads. Neither gets Repo Skills.
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
  const chat = params.get("chat")
  const tagged =
    chat === "room"
      ? mergeSkillIndexes({ canvas, app: getSkillIndex("coordinator") })
      : chat === "sketch"
        ? mergeSkillIndexes({ canvas, app: sketchSkillIndex() })
        : await getSkillMenuSource(params.get("sandbox"), canvas)

  const skills: SkillMenuItem[] = tagged.map((s) => ({
    name: s.name,
    description: s.description,
    origin: s.origin,
  }))
  const body: SkillsResponse = { skills }
  return Response.json(body)
}
