import type { SkillMetadata } from "./frontmatter"

/**
 * The merged Skill index and body resolver — the one place that owns the
 * App-vs-Repo collision rule.
 *
 * A Branch sees two Skill sources: App Skills (bundled `lib/skills/`) and Repo
 * Skills (its sandbox `.claude/skills/`). They merge into a single
 * origin-tagged list the agent's prompt and the `/` menu both draw from, and a
 * single body resolver `read_skill` routes through. The rule, stated once
 * here: **Repo wins on a name collision** — the checked-out repo overrides
 * screenplay's bundled default, the shadowed App row is dropped, and a body
 * lookup reads sandbox-first then falls back to the App Skill.
 */

export type SkillOrigin = "app" | "repo"

export interface OriginTaggedSkill extends SkillMetadata {
  origin: SkillOrigin
}

/**
 * Merge the App and Repo indexes into one deduped, origin-tagged, name-sorted
 * list. On a name collision the Repo row is kept (tagged `"repo"`) and the
 * App row dropped, so a Repo Skill shadows the bundled default it shares a
 * name with.
 */
export function mergeSkillIndexes(
  app: SkillMetadata[],
  repo: SkillMetadata[],
): OriginTaggedSkill[] {
  const byName = new Map<string, OriginTaggedSkill>()
  for (const s of app) {
    byName.set(s.name, { ...s, origin: "app" })
  }
  // Repo entries overwrite any App entry of the same name — Repo wins.
  for (const s of repo) {
    byName.set(s.name, { ...s, origin: "repo" })
  }
  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
}

/**
 * Resolve a Skill's full body by name, sandbox-first then app. Tries the Repo
 * Skill reader first so an override takes effect; falls back to the App Skill
 * reader when the Branch has no Repo Skill of that name. Returns `null` when
 * neither source has it — the caller turns that into an "unknown skill"
 * listing over {@link mergeSkillIndexes}.
 */
export async function resolveSkillBody(
  name: string,
  readers: {
    readRepoBody: (name: string) => Promise<string | null>
    readAppBody: (name: string) => string | null
  },
): Promise<string | null> {
  const repoBody = await readers.readRepoBody(name)
  if (repoBody !== null) return repoBody
  return readers.readAppBody(name)
}

/**
 * Render the merged set as the "available skills" listing shown when
 * `read_skill` is asked for a name that resolves to nothing.
 */
export function formatMergedListing(merged: OriginTaggedSkill[]): string {
  if (merged.length === 0) return "(none)"
  return merged.map((s) => `- ${s.name}: ${s.description}`).join("\n")
}
