import type {
  SkillMenuItem,
  SkillsResponse,
} from "@/app/api/agent/skills/route"
import { withBasePath } from "@/lib/base-path"

export type { SkillMenuItem }

/**
 * Client fetch for the `/`-composer skill index.
 *
 * Unlike `models-store`, the merged index is *branch- and canvas-specific* —
 * a Branch carries its own Repo Skills in `.claude/skills/`, which change as
 * the agent edits the working tree, and any chat can save a Skill to the
 * canvas. So this isn't cached app-wide: the index is fetched per source on
 * chat open and held by the chat for its lifetime, which means reopening a
 * chat picks up the refreshed list. Concurrent calls for the same source are
 * de-duped so a burst of opens issues a single request.
 */
const pending = new Map<string, Promise<SkillsResponse>>()

/** Where a Composer's `/` Skills come from: its Branch and its canvas. */
export interface SkillSource {
  /** The Branch's Sandbox, for its Repo Skills. */
  sandboxName?: string
  /** The canvas, for the Skills its chats saved. */
  roomId?: string
}

/** One string per source, for de-duping requests. */
export function skillSourceKey(source: SkillSource = {}): string {
  return `${source.roomId ?? ""}/${source.sandboxName ?? ""}`
}

/**
 * Fetch the merged skill index for `source`: its Branch's Repo Skills and its
 * canvas's saved Skills, merged with the App Skills. With neither the route
 * returns App Skills only.
 */
export async function getSkillMenuItems(
  source: SkillSource = {}
): Promise<SkillMenuItem[]> {
  const key = skillSourceKey(source)
  let inflight = pending.get(key)
  if (!inflight) {
    const query = new URLSearchParams()
    if (source.sandboxName) query.set("sandbox", source.sandboxName)
    if (source.roomId) query.set("room", source.roomId)
    const qs = query.toString()
    const url = withBasePath(`/api/agent/skills${qs ? `?${qs}` : ""}`)
    inflight = fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as SkillsResponse
      })
      .finally(() => {
        pending.delete(key)
      })
    pending.set(key, inflight)
  }
  return (await inflight).skills
}
