import type { SkillMetadata } from "./frontmatter"

/**
 * The merged Skill index and body resolver: the one place that owns which
 * Skill wins when two share a name.
 *
 * A chat sees Skills from several sources: Repo Skills (its Branch's
 * `.claude/skills/`, Workspace chats only), Canvas Skills (saved by any chat
 * on the canvas, `canvas.ts`), Account Skills (saved to the person who sent
 * the turn, `account.ts`), Harness Skills (the desktop chat's coding
 * agent's own, `agent-skills.ts`) and App Skills (bundled `lib/skills/`).
 * They merge into a single origin-tagged list the agent's prompt and the `/`
 * menu both draw from, and a single body resolver `read_skill` routes
 * through. The rule, stated once here as {@link SKILL_ORIGIN_RANK}: **Repo,
 * then Canvas, then Account, then the agent's own, then App** (spec #1554).
 * A shadowed row is dropped, and a body lookup tries each source in that
 * order.
 */

export type SkillOrigin = "repo" | "canvas" | "account" | "agent" | "app"

/** Which source wins a name collision, first to last. */
export const SKILL_ORIGIN_RANK: readonly SkillOrigin[] = [
  "repo",
  "canvas",
  "account",
  "agent",
  "app",
]

export interface OriginTaggedSkill extends SkillMetadata {
  origin: SkillOrigin
}

/**
 * Merge the sources' indexes into one deduped, origin-tagged, name-sorted
 * list. On a name collision only the row from the highest-ranked source
 * ({@link SKILL_ORIGIN_RANK}) is kept. A source a chat doesn't have is left
 * out.
 */
export function mergeSkillIndexes(
  sources: Partial<Record<SkillOrigin, readonly SkillMetadata[]>>
): OriginTaggedSkill[] {
  const byName = new Map<string, OriginTaggedSkill>()
  for (const origin of SKILL_ORIGIN_RANK) {
    for (const s of sources[origin] ?? []) {
      if (byName.has(s.name)) continue
      byName.set(s.name, { name: s.name, description: s.description, origin })
    }
  }
  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  )
}

/** Reads one source's Skill by name; `null` when it has none. */
export type SkillBodyReader = (
  name: string
) => Promise<string | null> | string | null

/**
 * Resolve a Skill's full content by name, trying each source in
 * {@link SKILL_ORIGIN_RANK} order so an override takes effect. Returns `null`
 * when no source has it; the caller turns that into an "unknown skill"
 * listing over {@link mergeSkillIndexes}.
 */
export async function resolveSkillBody(
  name: string,
  readers: Partial<Record<SkillOrigin, SkillBodyReader>>
): Promise<string | null> {
  for (const origin of SKILL_ORIGIN_RANK) {
    const body = await readers[origin]?.(name)
    if (body !== null && body !== undefined) return body
  }
  return null
}

/**
 * Render the merged set as the "available skills" listing shown when
 * `read_skill` is asked for a name that resolves to nothing.
 */
export function formatMergedListing(merged: OriginTaggedSkill[]): string {
  if (merged.length === 0) return "(none)"
  return merged.map((s) => `- ${s.name}: ${s.description}`).join("\n")
}
