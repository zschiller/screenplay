import {
  prependTurnMarkers,
  type PrEventKind,
  type PrEventMark,
} from "@/lib/agent/message-markers"
import type { PrEvent } from "./watch"

/**
 * How a PR event reads (#1702): the short label the chat's quiet line shows,
 * and the message the Workspace Chat records for its agent. Isomorphic, so the
 * line and the server share one wording.
 */

const LABEL: Record<PrEventKind, string> = {
  checks_failed: "checks failed",
  checks_passed: "checks passed",
  conflict: "conflict",
  review: "review",
  merged: "merged",
  closed: "closed",
}

/** The line's text after the PR number: “checks failed · lint”, “merged”,
 *  “review from ada · 2 comments”. */
export function prEventLabel({ kind, detail }: Omit<PrEventMark, "number">) {
  if (kind === "review" && detail) return `review from ${detail}`
  return detail ? `${LABEL[kind]} · ${detail}` : LABEL[kind]
}

/** What a review said, as PR Watch reads it (#1704). */
export type PrReviewVerdict = "approved" | "changes_requested" | "commented"

/** A new review: who left it, what it said, and its line comments. */
export interface PrReviewSummary {
  author: string
  verdict: PrReviewVerdict
  comments: number
}

const VERDICT: Record<PrReviewVerdict, string> = {
  approved: "approved",
  changes_requested: "changes requested",
  commented: "commented",
}

/**
 * A review event's detail: its author and how many line comments it left,
 * or its verdict when it left none (“ada · 2 comments”, “ada · approved”).
 */
export function prReviewDetail({
  author,
  verdict,
  comments,
}: PrReviewSummary): string {
  if (comments === 0) return `${author} · ${VERDICT[verdict]}`
  return `${author} · ${comments} ${comments === 1 ? "comment" : "comments"}`
}

/**
 * The state a PR event's line is drawn in, in GitHub's colours: green when
 * checks pass again, purple once merged, red for everything that needs a fix
 * or ended the PR. Failing checks and conflicts are an open PR that can't
 * merge, so they take the merge-blocked glyph; a closed PR takes closed's.
 * A review is news about an open PR, so it takes open's.
 */
export function prEventState(kind: PrEventKind): {
  state: "open" | "merged" | "closed"
  blocked?: boolean
} {
  if (kind === "checks_passed" || kind === "review") return { state: "open" }
  if (kind === "merged") return { state: "merged" }
  if (kind === "closed") return { state: "closed" }
  return { state: "open", blocked: true }
}

const SENTENCE: Record<PrEventKind, (n: number, detail?: string) => string> = {
  checks_failed: (n, detail) =>
    detail
      ? `PR #${n}’s checks failed: ${detail}.`
      : `PR #${n}’s checks failed.`,
  checks_passed: (n) => `PR #${n}’s checks passed.`,
  conflict: (n) => `PR #${n} has a merge conflict with its base branch.`,
  review: (n, detail) =>
    detail
      ? `New review on PR #${n} from ${detail}.`
      : `New review on PR #${n}.`,
  merged: (n) => `PR #${n} was merged.`,
  closed: (n) => `PR #${n} was closed without merging.`,
}

/** The PR events that wake the chat's agent (#1703): the ones that need a
 *  fix or a reply, or end the PR. Checks passing again is only a line. */
const WAKES: ReadonlySet<PrEventKind> = new Set<PrEventKind>([
  "checks_failed",
  "conflict",
  "review",
  "merged",
  "closed",
])

/** Whether a PR event wakes the chat's agent, rather than only showing. */
export function prEventWakes(kind: PrEventKind): boolean {
  return WAKES.has(kind)
}

/** What the agent does about a PR event that woke it. */
const NUDGE: Record<PrEventKind, string> = {
  checks_failed:
    "Read the failing checks, fix the cause and push. If you can’t fix it, reply saying why.",
  checks_passed: "",
  conflict:
    "Bring the base branch in, resolve the conflict and push. If you can’t resolve it safely, reply saying why.",
  review:
    "Read the review and its comments, fix and push what it asks for, then reply with what you changed and anything you left and why. If it only approves, reply in one line saying so.",
  merged:
    "Reply in one line saying the PR merged, unless something is left for the user.",
  closed:
    "Reply in one line saying the PR was closed, unless something is left for the user.",
}

const VERDICT_SENTENCE: Record<PrReviewVerdict, string> = {
  approved: "approved it",
  changes_requested: "requested changes",
  commented: "commented",
}

/** “ada reviewed PR #7 and requested changes, with 2 comments on lines.” */
function reviewSentence(
  n: number,
  { author, verdict, comments }: PrReviewSummary
): string {
  const lines =
    comments === 0
      ? ""
      : `, with ${comments} ${comments === 1 ? "comment" : "comments"} on lines`
  return `${author} reviewed PR #${n} and ${VERDICT_SENTENCE[verdict]}${lines}.`
}

/**
 * The Workspace Chat message for a PR event. It carries the `[pr event: …]`
 * marker, so the chat draws it as a quiet line rather than a bubble, while the
 * agent reads a plain sentence saying what happened and, for one that wakes
 * it, what to do.
 */
export function prEventMessage(event: PrEvent): string {
  const { number, kind, detail, url, review } = event
  return prependTurnMarkers(
    [
      review ? reviewSentence(number, review) : SENTENCE[kind](number, detail),
      url,
      "",
      "This is an automatic update from GitHub, not a message from the user.",
      ...(NUDGE[kind] ? [NUDGE[kind]] : []),
    ].join("\n"),
    { prEvent: { number, kind, ...(detail ? { detail } : {}) } }
  )
}
