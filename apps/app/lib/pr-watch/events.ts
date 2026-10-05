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
 * or ended the PR. Failing checks and conflicts are an open PR that can't
 * merge, so they take the merge-blocked glyph; a closed PR takes closed's.
 */
export function prEventState(kind: PrEventKind): {
  state: "open" | "merged" | "closed"
  blocked?: boolean
} {
  if (kind === "checks_passed") return { state: "open" }
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
  merged: (n) => `PR #${n} was merged.`,
  closed: (n) => `PR #${n} was closed without merging.`,
}

/** The PR events that wake the chat's agent (#1703): the ones that need a
 *  fix or end the PR. Checks passing again is only a line. */
const WAKES: ReadonlySet<PrEventKind> = new Set<PrEventKind>([
  "checks_failed",
  "conflict",
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
  merged:
    "Reply in one line saying the PR merged, unless something is left for the user.",
  closed:
    "Reply in one line saying the PR was closed, unless something is left for the user.",
}

/**
 * The Workspace Chat message for a PR event. It carries the `[pr event: …]`
 * marker, so the chat draws it as a quiet line rather than a bubble, while the
 * agent reads a plain sentence saying what happened and, for one that wakes
 * it, what to do.
 */
export function prEventMessage(event: PrEvent): string {
  const { number, kind, detail, url } = event
  return prependTurnMarkers(
    [
      SENTENCE[kind](number, detail),
      url,
      "",
      "This is an automatic update from GitHub, not a message from the user.",
      ...(NUDGE[kind] ? [NUDGE[kind]] : []),
    ].join("\n"),
    { prEvent: { number, kind, ...(detail ? { detail } : {}) } }
  )
}
