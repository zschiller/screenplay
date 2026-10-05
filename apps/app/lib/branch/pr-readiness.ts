import type { AgentMessage } from "@/lib/agent/types"
import type { BranchPrInfo, BranchPrState } from "@/lib/github-actions"
import { hasGitHubRemote } from "@/lib/repo-identity"
import type { BranchData, RepoData } from "@/lib/types"

/**
 * Create PR Readiness (#1666): whether a Workspace's Create pull request shows,
 * what blocks it and why, whether it's running, and the PR it already has.
 * The chat header's Create PR button and the Workspace menu's Create pull
 * request item both render from it, so they're shown, enabled and explained
 * the same way. `usePrReadiness` is the hook that feeds it Workspace State,
 * the GitHub probe and the creating-PR store, and adds the run action.
 *
 * Pure, so `pr-readiness.test.ts` asserts it from one table with no React.
 */

/** Create pull request's tooltip when the repo is on GitHub but this person
 *  hasn't connected it (H3). */
export const CONNECT_GITHUB_FOR_PR_HINT =
  "Connect GitHub in Settings to open pull requests."

/**
 * Whether a Repository's Workspaces can open a pull request:
 *  - `ready`: it has a GitHub remote and the GitHub API is reachable.
 *  - `connect`: it has a GitHub remote but there's no GitHub connection (the
 *    desktop app before `gh auth login`). Create pull request shows disabled
 *    with {@link CONNECT_GITHUB_FOR_PR_HINT}, so people learn where to fix it.
 *  - `none`: no GitHub remote (a local-only repo), or the token probe hasn't
 *    resolved yet. Create pull request is hidden.
 */
export type PrAvailability = "ready" | "connect" | "none"

export function prAvailability(
  repo: RepoData | undefined,
  githubToken: boolean | undefined
): PrAvailability {
  if (!hasGitHubRemote(repo) || githubToken === undefined) return "none"
  return githubToken ? "ready" : "connect"
}

/** The PR a Workspace already has: both places link it instead of offering
 *  to create one. */
export interface ExistingPr {
  url: string
  number: number
  state: BranchPrState
  /** An open PR that can't merge (failing checks, a conflict). */
  blocked?: boolean
}

/** A PR known only from a chat's `create_pr` result: a url and a number. */
export interface ChatPr {
  url: string
  number: number
}

export type PrBlockerKind =
  | "connect-github"
  | "starting"
  | "setup-failed"
  | "not-ready"
  | "agent-working"
  | "no-changes"

/** Why Create pull request is disabled, and the words its tooltip says. */
export interface PrBlocker {
  kind: PrBlockerKind
  reason: string
}

export interface PrReadinessInput {
  branch: Pick<
    BranchData,
    "sandboxName" | "ref" | "status" | "error" | "doneAt"
  >
  /** The polled PR for the Workspace's branch. */
  pr?: Pick<BranchPrInfo, "url" | "number" | "state" | "blocked"> | null
  /** The newest PR a chat on the Workspace created, from its transcript. */
  chatPr?: ChatPr | null
  availability: PrAvailability
  /** Workspace State's flag: any open chat's turn is in flight, for anyone. */
  agentWorking: boolean
  /** The Workspace has a diff against its base. */
  hasChanges: boolean
  /** A create is running for it in this tab (the creating-PR store). */
  running: boolean
}

export interface PrReadinessState {
  /** The PR to link in place of Create pull request, if there is one. */
  existingPr: ExistingPr | null
  /** Create pull request shows (enabled or not). False when there's a PR to
   *  link, the repo can't open one, or the Workspace is Done. */
  shown: boolean
  /** What keeps a shown Create pull request disabled. Null while it runs:
   *  the spinner says why then. */
  blocker: PrBlocker | null
  running: boolean
}

export interface PrReadiness extends PrReadinessState {
  /** Starts the create; does nothing unless it's shown and unblocked, or
   *  while one is running. */
  run: () => void
}

/**
 * The PR to link: the polled one, unless a chat created a newer one the poll
 * hasn't seen yet, which counts as open.
 */
function existingPrOf(
  pr: PrReadinessInput["pr"],
  chatPr: ChatPr | null | undefined
): ExistingPr | null {
  if (pr && (!chatPr || chatPr.number === pr.number)) {
    return {
      url: pr.url,
      number: pr.number,
      state: pr.state,
      blocked: pr.blocked,
    }
  }
  return chatPr ? { ...chatPr, state: "open" } : null
}

function blockerOf(input: PrReadinessInput): PrBlocker | null {
  const { branch } = input
  if (input.availability === "connect")
    return { kind: "connect-github", reason: CONNECT_GITHUB_FOR_PR_HINT }
  if (branch.status === "creating" || branch.status === "starting")
    return { kind: "starting", reason: "The workspace is still starting…" }
  if (branch.status === "error" || branch.error)
    return { kind: "setup-failed", reason: "The workspace’s setup failed." }
  if (!branch.sandboxName || !branch.ref)
    return { kind: "not-ready", reason: "The workspace isn’t ready yet." }
  if (input.agentWorking)
    return { kind: "agent-working", reason: "The agent is still working." }
  if (!input.hasChanges)
    return { kind: "no-changes", reason: "No changes to propose yet." }
  return null
}

/**
 * A Workspace's Create PR Readiness. A merged or closed PR still counts as
 * existing, so neither place offers a second PR from a finished Workspace.
 */
export function prReadiness(input: PrReadinessInput): PrReadinessState {
  const existingPr = existingPrOf(input.pr, input.chatPr)
  const shown =
    !existingPr && input.availability !== "none" && !input.branch.doneAt
  return {
    existingPr,
    shown,
    blocker: shown && !input.running ? blockerOf(input) : null,
    running: shown && input.running,
  }
}

/** Whether Create pull request can start now. */
export function canRunPr(state: PrReadinessState): boolean {
  return state.shown && !state.running && !state.blocker
}

/**
 * The newest completed `create_pr` tool call in a chat's messages, its PR url
 * and number read from the output.
 */
export function latestCreatedPr(
  messages: readonly AgentMessage[]
): ChatPr | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (
      m.role === "tool_call" &&
      m.title === "create_pr" &&
      m.status === "completed"
    ) {
      const output = m.content
        .map((b) =>
          b.type === "content" && b.content.type === "text"
            ? b.content.text
            : ""
        )
        .join("\n")
      const url = output.match(/https:\/\/github\.com\/[^\s]+/)?.[0]
      const num = output.match(/#(\d+)/)?.[1]
      if (url && num) return { url, number: Number(num) }
    }
  }
  return null
}
