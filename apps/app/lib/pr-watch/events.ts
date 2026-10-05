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
  merged: "merged",
  closed: "closed",
}

/** The line's text after the PR number: “checks failed · lint”, “merged”. */
export function prEventLabel({ kind, detail }: Omit<PrEventMark, "number">) {
  return detail ? `${LABEL[kind]} · ${detail}` : LABEL[kind]
}

/**
 * The state a PR event's line is drawn in, in GitHub's colours: green when
 * checks pass again, purple once merged, red for everything that needs a fix
 * or ended the PR.
 */
export function prEventState(kind: PrEventKind): "open" | "merged" | "closed" {
  if (kind === "checks_passed") return "open"
  if (kind === "merged") return "merged"
  return "closed"
}

const SENTENCE: Record<PrEventKind, (n: number, detail?: string) => string> = {
  checks_failed: (n, detail) =>
    detail
      ? `PR #${n}’s checks failed: ${detail}.`
      : `PR #${n}’s checks failed.`,
  checks_passed: (n) => `PR #${n}’s checks passed.`,
  conflict: (n) => `PR #${n} has a merge conflict with its base branch.`,
  merged: (n) => `PR #${n} was merged.`,
  closed: (n) => `PR #${n} was closed without merging.`,
}

/**
 * The Workspace Chat message for a PR event. It carries the `[pr event: …]`
 * marker, so the chat draws it as a quiet line rather than a bubble, while the
 * agent reads a plain sentence saying what happened.
 */
export function prEventMessage(event: PrEvent): string {
  const { number, kind, detail, url } = event
  return prependTurnMarkers(
    [
      SENTENCE[kind](number, detail),
      url,
      "",
      "This is an automatic update from GitHub, not a message from the user.",
    ].join("\n"),
    { prEvent: { number, kind, ...(detail ? { detail } : {}) } }
  )
}
