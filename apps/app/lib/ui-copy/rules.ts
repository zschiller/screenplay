/**
 * The copy rules the UI-copy check (`ui-copy.test.ts`) holds every user-facing
 * string to. The glossary (`apps/app/CONTEXT.md`) names each concept twice —
 * the structural term code uses, and the label people read — and these rules
 * keep the first out of rendered copy:
 *
 * - **Room → Canvas, Repo → Repository, Branch → Chat.** `room`, `repo`
 *   and `iframeLayer` never reach the screen. `branch` may, but only where the
 *   sentence is about git itself ("delete on remote", "base branch") — a git
 *   branch *is* a branch.
 * - **Chat, not workspace.** A Branch is a chat on screen: people start,
 *   pick and delete chats, and a frame shows a chat's code. "Workspace" is
 *   the code's name for it and stays there.
 * - **No "project".** It used to label a Repo; since #880 the canvas is what
 *   works like a project, so the word names neither and stays off the screen.
 * - **The ellipsis character.** `…`, never three ASCII dots.
 * - **Control, not drive.** Taking over a frame is "control" ("Take
 *   control", "Ana has control"); a tool row says the agent "Used" a page.
 *   "Frame Drive" is the code's name for it and stays there.
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
  { rule: "workspace → chat", pattern: /\bworkspaces?\b/i },
  { rule: "use the … character", pattern: /\.\.\./ },
  {
    rule: "drive → control (or use)",
    pattern: /\b(driv(e|es|en|ing|ers?)|drove)\b/i,
  },
]

/** Structural terms that are fine in git-level copy and nowhere else. */
const GIT_LEVEL_ONLY: Array<{ rule: string; pattern: RegExp }> = [
  { rule: "branch → chat", pattern: /\bbranch(es)?\b/i },
]

/** Words that mark a string as talking about git, where "branch" is the
 *  right word. "Rename branch" is the Git menu's rename of the git branch
 *  itself, as opposed to the chat's title (#881). */
const GIT_CONTEXT =
  /\b(git|github|origin|remote|clone|cloning|pull requests?|(base|local|default) branch(es)?|rename branch)\b/i

/**
 * The rule {@link findProseViolations} holds all prose to: "workspace" as a
 * word, not inside a class name, a `data-slot`, a package path or a quoted
 * code value (`"workspace"`).
 */
const WORKSPACE_WORD = /(?<![-\w:/=@."])workspaces?(?![-\w:/=@"])/i

/** Violations in any prose, whether or not it is known to be UI copy:
 *  "workspace" is the code's word for a chat, and a person never reads it
 *  in a toast, an error or a status line either. */
export function findProseViolations(text: string): CopyViolation[] {
  const m = text.match(WORKSPACE_WORD)
  return m ? [{ rule: "workspace → chat", match: m[0] }] : []
}

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
