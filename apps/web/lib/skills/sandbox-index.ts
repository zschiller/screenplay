import "server-only"

import { sandboxProvider } from "@/lib/sandbox"
import type { SandboxInstance } from "@/lib/sandbox"

import { getSkill, getSkillIndex } from "./index"
import {
  enumerateRepoSkills,
  readRepoSkillBody,
  sandboxRepoSkillFs,
} from "./repo-skills"
import {
  mergeSkillIndexes,
  resolveSkillBody,
  type OriginTaggedSkill,
} from "./merged"
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

async function enumerateRepoSkillsForSandbox(
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
 * The merged, origin-tagged Skill index for a Branch's sandbox: App Skills
 * (always) plus its Repo Skills (best-effort), deduped Repo-wins. Baked into
 * the per-Agent system prompt at chat init — so editing a Repo Skill on a
 * branch and reopening the chat rolls a fresh prompt — and used for the
 * unknown-name listing in `read_skill`.
 */
export async function getMergedSkillIndexForSandbox(
  sandboxName: string
): Promise<OriginTaggedSkill[]> {
  const repo = await enumerateRepoSkillsForSandbox(sandboxName)
  return mergeSkillIndexes(getSkillIndex(), repo)
}

/**
 * The `/`-menu Skill source for a Composer, honest about the pre-Sandbox case.
 * With a `sandboxName` it returns the Branch's merged App ∪ Repo index
 * (Repo-wins on collision); without one — the seed Composer of the
 * New-Workspace dialog, which renders before any Sandbox exists — it returns
 * App Skills only, so the menu offers the bundled `screenplay-*` Skills rather
 * than bailing. Repo enumeration is skipped entirely when there is no Sandbox.
 */
export async function getSkillMenuSource(
  sandboxName?: string | null
): Promise<OriginTaggedSkill[]> {
  const repo = sandboxName
    ? await enumerateRepoSkillsForSandbox(sandboxName)
    : null
  return resolveSkillMenuSource(getSkillIndex(), repo)
}

/**
 * Resolve a Skill's body for `read_skill`, sandbox-first then app. Reads the
 * Branch's Repo Skill of that name if present (so an override wins), otherwise
 * the bundled App Skill. Returns `null` when neither has it.
 */
export async function resolveSkillBodyForSandbox(
  sandboxName: string,
  name: string
): Promise<string | null> {
  return resolveSkillBody(name, {
    readRepoBody: async (n) => {
      try {
        const sandbox: SandboxInstance = await sandboxProvider.get({
          name: sandboxName,
        })
        return await readRepoSkillBody(sandboxRepoSkillFs(sandbox), n)
      } catch {
        // Sandbox unreachable — fall through to the App Skill.
        return null
      }
    },
    readAppBody: (n) => getSkill(n),
  })
}
