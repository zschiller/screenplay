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
 *  - **No Sandbox** (`repo === null`): App Skills only, each tagged `"app"`.
 *    Repo Skills live in a Branch's `.claude/skills/` and simply don't exist
 *    until the Branch is checked out, so the menu offers the bundled
 *    `screenplay-*` App Skills and nothing else — no error, no empty bail.
 *  - **Sandbox present** (`repo` is an array, possibly empty): the merged
 *    App ∪ Repo set with Repo shadowing App on a name collision, exactly as
 *    {@link mergeSkillIndexes} defines it.
 *
 * Passing `null` rather than `[]` for the no-Sandbox case keeps the distinction
 * explicit at the call site: a missing Sandbox means "don't even look for Repo
 * Skills," not "a Sandbox with zero Repo Skills." The two happen to produce the
 * same App-only output, but the intent — and the absence of a sandbox round
 * trip — is what this seam is for.
 */
export function resolveSkillMenuSource(
  app: SkillMetadata[],
  repo: OriginTaggedSkill[] | null
): OriginTaggedSkill[] {
  if (repo === null) {
    return app
      .map((s) => ({ ...s, origin: "app" as const }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  return mergeSkillIndexes(app, repo)
}
