/**
 * The copy rules the UI-copy check (`ui-copy.test.ts`) holds every user-facing
 * string to. The glossary (`apps/app/CONTEXT.md`) names each concept twice —
 * the structural term code uses, and the label people read — and these rules
 * keep the first out of rendered copy:
 *
 * - **Room → Canvas, Repo → Repository, Branch → Workspace.** `room`, `repo`
 *   and `iframeLayer` never reach the screen. `branch` may, but only where the
 *   sentence is about git itself ("delete on remote", "base branch") — a git
 *   branch *is* a branch.
 * - **No "project".** It used to label a Repo; since #880 the canvas is what
 *   works like a project, so the word names neither and stays off the screen.
 * - **The ellipsis character.** `…`, never three ASCII dots.
 *
 * "Sandbox" is deliberately absent: it is a UI label in its own right
 * ("Restart sandbox"), so its misuse is a review call, not a lint.
 */

export interface CopyViolation {
  rule: string
  match: string
}

/** Code terms that are never a UI label, in any context. */
const ALWAYS_BANNED: Array<{ rule: string; pattern: RegExp }> = [
  { rule: "room → canvas", pattern: /\brooms?\b/i },
  { rule: "repo → repository", pattern: /\brepos?\b/i },
  { rule: "project → repository (or canvas)", pattern: /\bprojects?\b/i },
  { rule: "iframeLayer → frame", pattern: /\biframe ?layers?\b/i },
  { rule: "use the … character", pattern: /\.\.\./ },
]

/** Structural terms that are fine in git-level copy and nowhere else. */
const GIT_LEVEL_ONLY: Array<{ rule: string; pattern: RegExp }> = [
  { rule: "branch → workspace", pattern: /\bbranch(es)?\b/i },
]

/** Words that mark a string as talking about git, where "branch" is the
 *  right word. */
const GIT_CONTEXT =
  /\b(git|github|origin|remote|clone|cloning|pull requests?|(base|local|default) branch(es)?)\b/i

export function findCopyViolations(text: string): CopyViolation[] {
  const out: CopyViolation[] = []
  for (const { rule, pattern } of ALWAYS_BANNED) {
    const m = text.match(pattern)
    if (m) out.push({ rule, match: m[0] })
  }
  if (!GIT_CONTEXT.test(text)) {
    for (const { rule, pattern } of GIT_LEVEL_ONLY) {
      const m = text.match(pattern)
      if (m) out.push({ rule, match: m[0] })
    }
  }
  return out
}
