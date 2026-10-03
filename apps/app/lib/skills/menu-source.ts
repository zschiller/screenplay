import type { SkillMetadata } from "./frontmatter"
import { mergeSkillIndexes, type OriginTaggedSkill } from "./merged"

/**
 * The `/`-menu Skill source, made honest about the pre-Sandbox case.
 *
 * The Composer renders in two situations: in a chat (a Branch with a checked-out
 * Sandbox) and as the seed Composer of the New-Workspace dialog (before any
 * Sandbox exists). Its `/` menu draws from this one resolver so it never
 * promises a Skill it cannot yet see:
 *
 *  - **No Sandbox** (`repo === null`): the canvas's and App Skills, Canvas
 *    shadowing App on a name collision.
 *    Repo Skills live in a Branch's `.claude/skills/` and simply don't exist
 *    until the Branch is checked out, so the menu offers no Repo Skills — no
 *    error, no empty bail.
 *  - **Sandbox present** (`repo` is an array, possibly empty): the merged
 *    Repo, Canvas and App set, ranked as {@link mergeSkillIndexes} defines.
 *
 * Passing `null` rather than `[]` for the no-Sandbox case keeps the distinction
 * explicit at the call site: a missing Sandbox means "don't even look for Repo
 * Skills," not "a Sandbox with zero Repo Skills." The two happen to produce the
 * same App-only output, but the intent — and the absence of a sandbox round
 * trip — is what this seam is for.
 */
export function resolveSkillMenuSource(
  app: readonly SkillMetadata[],
  repo: readonly SkillMetadata[] | null,
  canvas: readonly SkillMetadata[] = []
): OriginTaggedSkill[] {
  return mergeSkillIndexes({ app, canvas, ...(repo ? { repo } : {}) })
}
