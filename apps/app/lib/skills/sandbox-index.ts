import "server-only"

import { sandboxProvider } from "@/lib/sandbox"

import { sandboxRepoSkillFs, type RepoSkillFs } from "./repo-skills"

/**
 * Server-side bridge between the pure Skill modules and a live sandbox: where
 * a Workspace chat's Skill Sources (`sources.ts`) reach the Branch's working
 * tree for its Repo Skills.
 */

/**
 * A Branch's Repo Skill filesystem, or `null` when its sandbox is
 * unreachable, so Skill Sources fall through to the other sources instead of
 * failing.
 */
export async function repoSkillFsForSandbox(
  sandboxName: string
): Promise<RepoSkillFs | null> {
  try {
    return sandboxRepoSkillFs(await sandboxProvider.get({ name: sandboxName }))
  } catch {
    return null
  }
}
