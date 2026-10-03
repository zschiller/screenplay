import { sketchSkillIndex } from "@/lib/agent/sketch-tools"
import { getUserId } from "@/lib/auth-helpers"
import { openRoomForRoute } from "@/lib/room-access"
import { getSkillIndex } from "@/lib/skills"
import { loadCanvasSkills } from "@/lib/skills/canvas"
import { loadAccountSkills } from "@/lib/skills/account"
import { mergeSkillIndexes, type SkillOrigin } from "@/lib/skills/merged"
import { getSkillMenuSource } from "@/lib/skills/sandbox-index"
import { turnHarnessKey } from "@/lib/agent/acp/engine-choice"
import { agentSkillsFor, loadAgentSkills } from "@/lib/skills/agent-skills"

/**
 * Origin-tagged skill metadata for the `/` composer menu. With a `sandbox`
 * query param the response includes that Branch's Repo Skills; with a `room`
 * param, that canvas's saved Skills (for a member of it only). Your own
 * Account Skills (#1558) always join them, since every turn you send uses
 * them. They merge with the App Skills ranked Repo, then Canvas, then
 * Account, then App, a shadowed row dropped.
 *
 * A `chat` param names a chat with no Branch (#1556): `room` (the
 * Coordinator) lists the canvas's and the Coordinator's App Skills, `sketch`
 * the canvas's and the Mockup App Skills, each what that chat's `read_skill`
 * reads. Neither gets Repo Skills.
 *
 * A `model` param is the chat's model. On the desktop it picks the coding
 * agent running the chat, whose own Skills (`~/.claude/skills` for Claude
 * Code) rank below your Account Skills and above App Skills (#1560).
 */
export interface SkillMenuItem {
  name: string
  description: string
  origin: SkillOrigin
  /** The agent's name, on its own Skills (`origin: "agent"`). */
  agentName?: string
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
  const account = await loadAccountSkills(userId)
  const agentSkills = agentSkillsFor(
    turnHarnessKey(params.get("model") ?? undefined)
  )
  const agent = await loadAgentSkills(agentSkills)
  const chat = params.get("chat")
  const tagged =
    chat === "room"
      ? mergeSkillIndexes({
          canvas,
          account,
          agent,
          app: getSkillIndex("coordinator"),
        })
      : chat === "sketch"
        ? mergeSkillIndexes({ canvas, account, agent, app: sketchSkillIndex() })
        : await getSkillMenuSource(params.get("sandbox"), {
            canvas,
            account,
            agent,
          })

  const skills: SkillMenuItem[] = tagged.map((s) => ({
    name: s.name,
    description: s.description,
    origin: s.origin,
    ...(s.origin === "agent" && agentSkills
      ? { agentName: agentSkills.agentName }
      : {}),
  }))
  const body: SkillsResponse = { skills }
  return Response.json(body)
}
