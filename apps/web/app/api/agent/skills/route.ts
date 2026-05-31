import { getUserId } from "@/lib/auth-helpers"
import { getSkillIndex } from "@/lib/skills"

/**
 * Origin-tagged skill metadata for the `/` composer menu. This slice ships
 * App Skills only (screenplay's bundled `lib/skills/`), so every row is
 * tagged `"app"`; the Repo-Skill source is layered in by a later slice.
 */
export interface SkillMenuItem {
  name: string
  description: string
  origin: "app"
}

export interface SkillsResponse {
  skills: SkillMenuItem[]
}

export const runtime = "nodejs"

export async function GET() {
  const userId = await getUserId()
  if (!userId) return new Response("Unauthorized", { status: 401 })
  const skills: SkillMenuItem[] = getSkillIndex().map((s) => ({
    name: s.name,
    description: s.description,
    origin: "app",
  }))
  const body: SkillsResponse = { skills }
  return Response.json(body)
}
