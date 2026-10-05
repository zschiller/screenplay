import { getUserId } from "@/lib/auth-helpers"
import { openRoomForRoute, type RoomDoc } from "@/lib/room-access"
import type { SkillOrigin } from "@/lib/skills/sources"
import { turnHarnessKey } from "@/lib/agent/acp/engine-choice"
import { agentSkillsFor } from "@/lib/skills/agent-skills"
import { roomChatTarget } from "@/lib/agent/room-chat-target"
import { sketchChatTarget } from "@/lib/agent/sketch-chat-target"
import { workspaceChatTarget } from "@/lib/agent/workspace-chat-target"

/**
 * Origin-tagged skill metadata for the `/` composer menu: the index of the
 * chat's Skill Sources (`lib/skills/sources.ts`), as its Chat Target builds
 * them, so the menu lists what that chat's `read_skill` reads. With a
 * `sandbox` query param it includes that Branch's Repo Skills; with a `room`
 * param, that canvas's saved Skills (for a member of it only). Your own
 * Account Skills (#1558) always join them, since every turn you send uses
 * them.
 *
 * A `chat` param names a chat with no Branch (#1556): `room` (the
 * Coordinator) or `sketch`. Neither gets Repo Skills.
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
  let room: RoomDoc | null = null
  if (roomId) {
    const opened = await openRoomForRoute(roomId)
    if (opened instanceof Response) return opened
    room = opened
  }
  const harnessKey = turnHarnessKey(params.get("model") ?? undefined)
  const agentSkills = agentSkillsFor(harnessKey)
  const target = { userId, harnessKey }
  const chat = params.get("chat")
  const sources =
    chat === "room"
      ? roomChatTarget.skills(room, target)
      : chat === "sketch"
        ? sketchChatTarget.skills(room, { ...target, chatId: "" })
        : workspaceChatTarget.skills(room, {
            ...target,
            chatId: "",
            sandboxName: params.get("sandbox") ?? "",
          })
  const tagged = await sources.index()

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
