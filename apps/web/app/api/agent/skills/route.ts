import { getUserId } from "@/lib/auth-helpers"
import { getSkillIndex } from "@/lib/skills"
import { getMergedSkillIndexForSandbox } from "@/lib/skills/sandbox-index"
import type { SkillOrigin } from "@/lib/skills/merged"

/**
 * Origin-tagged skill metadata for the `/` composer menu. With a `sandbox`
 * query param the response is the merged App ∪ Repo index for that Branch
 * (Repo-wins on a name collision, the shadowed App row dropped); without one
 * it degrades to App Skills only — so a chat with no sandbox (or a sandbox we
 * can't reach) still lists the bundled Skills.
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

  const sandboxName = new URL(request.url).searchParams.get("sandbox")
  const tagged: { name: string; description: string; origin: SkillOrigin }[] =
    sandboxName
      ? await getMergedSkillIndexForSandbox(sandboxName)
      : getSkillIndex().map((s) => ({
          name: s.name,
          description: s.description,
          origin: "app" as const,
        }))

  const skills: SkillMenuItem[] = tagged.map((s) => ({
    name: s.name,
    description: s.description,
    origin: s.origin,
  }))
  const body: SkillsResponse = { skills }
  return Response.json(body)
}
