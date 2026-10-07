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
 * - **Agent, not Claude.** The agent is "the agent" whichever model runs it.
 *   "Claude Code", the coding CLI, and "Open in Claude" (claude.ai) are
 *   product names and stay.
 * - **Preview, not dev server.** What a chat runs and a frame shows is its
 *   preview. Agent tool names and prompts keep "dev server".
 * - **Remove, not Turn off.** Taking a repository (or anything else) off a
 *   list is "Remove".
 * - **Terminal, not shell.** A terminal tab is a terminal. The desktop app's
 *   Tauri shell and your login shell are other things and keep the word.
 * - **Play mode, not prototype player.**
 *
 * Docs (but not the app or the homepage) also call the deployed app
 * "Hosted" / "the hosted app", never "the web app" ({@link findSiteViolations}).
 *
 * "Sandbox" is deliberately absent: the menus no longer say it, but error
 * text from the backend may, so its misuse is a review call, not a lint.
 */

export interface CopyViolation {
  rule: string
  match: string
}

/** Code terms that are never a UI label in the app. The docs and homepage
 *  may name them: the docs explain git branches, Vercel projects and the
 *  glossary's code names, and the homepage talks about "your repo". */
const CODE_TERMS: Array<{ rule: string; pattern: RegExp }> = [
  { rule: "room → canvas", pattern: /\brooms?\b/i },
  { rule: "repo → repository", pattern: /\brepos?\b/i },
  { rule: "project → repository (or canvas)", pattern: /\bprojects?\b/i },
  { rule: "iframeLayer → frame", pattern: /\biframe ?layers?\b/i },
]

/** Labels every surface a person reads holds to: the app, the docs and the
 *  homepage. */
const LABELS: Array<{ rule: string; pattern: RegExp; unless?: RegExp }> = [
  { rule: "workspace → chat", pattern: /\bworkspaces?\b/i },
  { rule: "use the … character", pattern: /\.\.\./ },
  {
    rule: "drive → control (or use)",
    pattern: /\b(driv(e|es|en|ing)|drove)\b/i,
  },
  // A database driver is the database's word, not the frame's.
  {
    rule: "drive → control (or use)",
    pattern: /\bdrivers?\b/i,
    unless: /\b(postgres|database|neon)\b/i,
  },
  // Claude Code is the coding CLI, and "Open in Claude" opens claude.ai.
  { rule: "Claude → agent", pattern: /(?<!\bOpen in )\bClaude\b(?! Code)/ },
  { rule: "dev server → preview", pattern: /\bdev[ -]?servers?\b/i },
  { rule: "turn off → remove", pattern: /\bturn(s|ed|ing)? off\b/i },
  {
    rule: "shell → terminal",
    pattern: /(?<!\b(tauri|desktop|login) )\bshells?\b/i,
  },
  { rule: "prototype player → play mode", pattern: /\bprototype player\b/i },
]

/** Docs-only labels: the deployed app is "Hosted" / "the hosted app". */
const DOCS_ONLY: Array<{ rule: string; pattern: RegExp }> = [
  { rule: "web app → hosted app", pattern: /\bweb ?apps?\b/i },
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

const matches = (
  text: string,
  rules: Array<{ rule: string; pattern: RegExp; unless?: RegExp }>
): CopyViolation[] =>
  rules.flatMap(({ rule, pattern, unless }) => {
    if (unless?.test(text)) return []
    const m = text.match(pattern)
    return m ? [{ rule, match: m[0] }] : []
  })

/** Violations in a string of app UI copy. */
export function findCopyViolations(text: string): CopyViolation[] {
  return [
    ...matches(text, CODE_TERMS),
    ...matches(text, LABELS),
    ...(GIT_CONTEXT.test(text) ? [] : matches(text, GIT_LEVEL_ONLY)),
  ]
}

/** Violations in docs or homepage copy: the {@link LABELS}, and on the docs
 *  "hosted app". */
export function findSiteViolations(
  text: string,
  site: "docs" | "homepage"
): CopyViolation[] {
  return [
    ...matches(text, LABELS),
    ...(site === "docs" ? matches(text, DOCS_ONLY) : []),
  ]
}
