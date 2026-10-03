import "server-only"

import { sandboxProvider } from "@/lib/sandbox"

import type { SkillMetadata } from "./frontmatter"
import { getSkillIndex } from "./index"
import {
  enumerateRepoSkills,
  sandboxRepoSkillFs,
  type RepoSkillFs,
} from "./repo-skills"
import type { OriginTaggedSkill } from "./merged"
import { resolveSkillMenuSource } from "./menu-source"

/**
 * Server-side bridge between the pure Skill modules and a live sandbox. This
 * is where the single "enumerate `.claude/skills` once at chat init" round
 * trip happens, and where `read_skill` reaches the Branch's working tree.
 *
 * Repo-Skill discovery is best-effort: a missing `.claude/skills/` already
 * yields an empty list inside the enumerator, and any other failure
 * (unreachable sandbox, a malformed Repo Skill that trips the dir-name
 * invariant) is caught here and degrades to "no Repo Skills" so a single bad
 * Skill on a branch can't take down the whole chat. The App Skills always show.
 */

/**
 * A Branch's Repo Skills, best-effort: an unreachable sandbox or a malformed
 * Repo Skill reads as none.
 */
export async function enumerateRepoSkillsForSandbox(
  sandboxName: string
): Promise<OriginTaggedSkill[]> {
  try {
    const sandbox = await sandboxProvider.get({ name: sandboxName })
    return await enumerateRepoSkills(sandboxRepoSkillFs(sandbox))
  } catch (e) {
    console.error(
      `Repo Skill enumeration failed for sandbox "${sandboxName}":`,
      e
    )
    return []
  }
}

/**
 * The `/`-menu Skill source for a Composer, honest about the pre-Sandbox case.
 * With a `sandboxName` it returns the Branch's merged index (Repo, Canvas,
 * the agent's own, App); without one (the seed Composer of the New-Workspace
 * dialog, which renders before any Sandbox exists) it leaves out Repo Skills
 * rather than bailing. `canvas` is the canvas's saved Skills, when the
 * Composer is on one, and `agent` the desktop agent's own (#1560).
 */
export async function getSkillMenuSource(
  sandboxName: string | null | undefined,
  canvas: readonly SkillMetadata[] = [],
  agent: readonly SkillMetadata[] = []
): Promise<OriginTaggedSkill[]> {
  const repo = sandboxName
    ? await enumerateRepoSkillsForSandbox(sandboxName)
    : null
  return resolveSkillMenuSource(getSkillIndex(), repo, canvas, agent)
}

/**
 * A Branch's Repo Skill filesystem, or `null` when its sandbox is
 * unreachable, so `read_skill` falls through to the other sources instead of
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
