import type { SkillMenuItem, SkillsResponse } from "@/app/api/agent/skills/route"

export type { SkillMenuItem }

/**
 * Client fetch for the `/`-composer skill index.
 *
 * Unlike `models-store`, the merged App ∪ Repo index is *branch-specific* —
 * a Branch carries its own Repo Skills in `.claude/skills/`, and those can
 * change as the agent edits the working tree. So this isn't cached app-wide:
 * the index is fetched per sandbox on chat open and held by the chat for its
 * lifetime, which means reopening a chat after editing a Repo Skill picks up
 * the refreshed list. Concurrent calls for the same sandbox are de-duped so a
 * burst of opens issues a single request.
 */
const pending = new Map<string, Promise<SkillsResponse>>()

/**
 * Fetch the merged skill index for `sandboxName`'s Branch (App ∪ Repo). With
 * no sandbox the route returns App Skills only — used by chats with no
 * working tree to enumerate.
 */
export async function getSkillMenuItems(
  sandboxName?: string,
): Promise<SkillMenuItem[]> {
  const key = sandboxName ?? ""
  let inflight = pending.get(key)
  if (!inflight) {
    const url = sandboxName
      ? `/api/agent/skills?sandbox=${encodeURIComponent(sandboxName)}`
      : "/api/agent/skills"
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
