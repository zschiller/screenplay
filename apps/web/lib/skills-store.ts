import type { SkillMenuItem, SkillsResponse } from "@/app/api/agent/skills/route"

export type { SkillMenuItem }

/**
 * Client cache for the `/`-composer skill index. Mirrors `models-store`:
 * the catalog is fetched once per session and reused, since the App Skill
 * set is branch-independent and changes only across deploys.
 */
let cache: SkillsResponse | null = null
let pending: Promise<SkillsResponse> | null = null

function fetchCatalog(): Promise<SkillsResponse> {
  if (cache) return Promise.resolve(cache)
  if (pending) return pending
  pending = fetch("/api/agent/skills")
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as SkillsResponse
      cache = data
      return data
    })
    .finally(() => {
      pending = null
    })
  return pending
}

export async function getSkillMenuItems(): Promise<SkillMenuItem[]> {
  return (await fetchCatalog()).skills
}
