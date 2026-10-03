/**
 * The pure core of a desktop release's notes: which merged pull requests a
 * release carries, which of them people using the app would notice, and the
 * brief a model gets to turn them into a readable changelog. Git, `gh` and the
 * model run in `apps/desktop/scripts/release.mjs`; this module only shapes
 * their input and output, so it stays unit-testable like `release-version.ts`.
 */

/** A pull request squash-merged onto main, read from its commit subject. */
export interface MergedPr {
  number: number
  title: string
}

/** A merged pull request plus its description, as the notes brief reads it. */
export interface MergedPrWithBody extends MergedPr {
  body: string
}

// Commits that land on main but never change the app someone downloads.
const SKIPPED_SUBJECTS = [
  /^Release Screenplay Desktop /,
  /^Release @screenplay\.space\//,
  /^docs: refresh screenshots/i,
]

// Squash merges end in "(#123)"; a PR that closes an issue named in its title
// ends in "(#1182) (#1188)", where the last number is the PR.
const TRAILING_REFS_RE = /(?:\s*\(#\d+\))+\s*$/
const LAST_REF_RE = /\(#(\d+)\)\s*$/

/**
 * Merged pull requests from first-parent commit subjects on main, newest
 * first as `git log` gives them. Direct commits (no "(#N)") and release
 * bookkeeping are dropped.
 */
export function mergedPrsFromSubjects(subjects: Iterable<string>): MergedPr[] {
  const prs: MergedPr[] = []
  for (const subject of subjects) {
    if (SKIPPED_SUBJECTS.some((re) => re.test(subject))) continue
    const ref = LAST_REF_RE.exec(subject)
    if (!ref) continue
    prs.push({
      number: Number(ref[1]),
      title: subject.replace(TRAILING_REFS_RE, "").trim(),
    })
  }
  return prs
}

// What ships inside the desktop app: the app itself, the shell around it and
// the shared packages both build from. Tests, screenshots and docs inside
// those folders change nothing anyone downloading the app would see.
const SHIPPED_PREFIXES = ["apps/app/", "apps/desktop/", "packages/"]
const UNSHIPPED_RE =
  /^apps\/app\/(?:screenshots|test|e2e)\/|\.test\.[cm]?[jt]sx?$|\.md$/

/** Whether a commit touching these paths changes the app people download. */
export function changesTheApp(paths: Iterable<string>): boolean {
  for (const path of paths) {
    if (!SHIPPED_PREFIXES.some((prefix) => path.startsWith(prefix))) continue
    if (UNSHIPPED_RE.test(path)) continue
    return true
  }
  return false
}

// A PR description past this is mostly test plans and screenshots.
const BODY_LIMIT = 1500

/**
 * The brief a model gets to write a release's notes. Its reply is used as the
 * Release body as-is, so the brief carries the whole house style.
 */
export function releaseNotesPrompt({
  version,
  prs,
}: {
  version: string
  prs: MergedPrWithBody[]
}): string {
  const changes = prs
    .map((pr) => {
      const body = pr.body.trim().slice(0, BODY_LIMIT)
      return `## ${pr.title} (#${pr.number})\n\n${body || "(no description)"}`
    })
    .join("\n\n")
  return `Write the release notes for Screenplay Desktop ${version}, a Mac app where coding agents build every branch of a project side by side on a canvas of live previews.

The readers are people who use the app, not its developers. Below are the pull requests merged since the last release, with their descriptions. Turn them into a short changelog of what changed for those readers.

Format, in Markdown:
- Open with one or two plain sentences on the most important change.
- Then up to three sections, each only if it has entries, in this order: "### New", "### Improved", "### Fixed".
- One bullet per feature, not per detail: merge related pull requests, and the parts of one feature, into a single bullet. Each bullet is one or two plain sentences in the present tense that say what someone can now do or what now works.
- Keep it short: never more than 12 bullets in total across all sections, and a few for a small release. Drop the least noticeable changes to stay under that.
- No pull request numbers, authors, links, commit hashes or headings other than those three.

Leave out anything a person using the app would never notice: refactors, tests, CI, dependency upgrades, the docs site and the homepage. Leave out small visual tweaks unless together they change how something looks; then give them one bullet. If nothing is left, write the single sentence "Behind-the-scenes fixes and maintenance."

Words: say "agent" for the coding agent, never "Claude" (naming a coding tool such as Claude Code or Codex is fine). Lowercase product nouns mid-sentence (canvas, workspace, frame, chat), except Coordinator. No jargon such as refactor, seam, harness, ACP or FSM. No exclamation marks.

Reply with only the release notes.

# Merged pull requests

${changes}
`
}

/** Notes when no model is available: the app's pull request titles, as is. */
export function fallbackReleaseNotes(prs: MergedPr[]): string {
  if (prs.length === 0) return "Behind-the-scenes fixes and maintenance."
  return ["### Changes", "", ...prs.map((pr) => `- ${pr.title}`)].join("\n")
}

/** The notes with a closing link to every commit in the release. */
export function withCompareLink(
  notes: string,
  { repo, previousTag, tag }: { repo: string; previousTag: string; tag: string }
): string {
  const url = `https://github.com/${repo}/compare/${previousTag}...${tag}`
  return `${notes.trim()}\n\n[Every change since ${previousTag.replace(/^desktop-v/, "")}](${url})\n`
}
