import type { BranchData, RepoData } from "@/lib/types"

/**
 * The single recovery action the Canvas takes for one Branch at mount time,
 * resolved from a plain snapshot of the Branch and its (already-looked-up) Repo.
 *
 * Mount-time Sandbox recovery is the third member of the canvas triad pattern
 * (alongside `resolveEscapeAction` and the Branch-Actions decision): a
 * React-free, Yjs-free **decision** here, applied by the thin
 * `useSandboxReconnect` controller. Splitting the branch selection out lets the
 * recovery cascade be asserted as observable behaviour — bare `agent` + `repo`
 * in, the chosen action out — rather than against the canvas component's wiring.
 * The async apply (the `/api/branch/create` resume POST, `reconnectSandbox` /
 * `recreateSandbox`, the `updateAgentInStorage` writes) lives in the controller;
 * only the branch selection is pure.
 */
export type ReconnectAction =
  /**
   * Status `creating` with a `sandboxName`: the VM exists but the create
   * pipeline was interrupted (page reload mid-creation). Ask the server to
   * resume it — it holds a Redis lock so only one client drives the resume.
   */
  | {
      kind: "resume-create"
      sandboxName: string
      branchId: string
      branch: string
      repoId: string
    }
  /**
   * Status `creating` with no `sandboxName`: the VM was never created, so
   * there's nothing to resume. Mark the Branch errored — delete and retry.
   */
  | { kind: "unrecoverable" }
  /**
   * Running / starting (or any non-`creating` status) with a resolvable Repo:
   * probe the existing sandbox and reattach. `repo` and `ref` ride along so the
   * controller's only failure path is an explicit **Recreate** (ADR 0005) — a
   * resume that fails on an expired snapshot recreates from git rather than
   * silently recloning or stranding the user at "stopped".
   */
  | {
      kind: "reconnect"
      sandboxName: string
      repo: RepoData
      ref: string
    }
  /**
   * A sandbox to reconnect, but its Repo is gone — there's no source to
   * provision from on a failed resume. Land at stopped with a retry hint.
   */
  | { kind: "repo-missing" }
  /**
   * Nothing to recover: a non-`creating` Branch that never had a sandbox. The
   * controller skips it.
   */
  | { kind: "none" }

/**
 * Resolve the one recovery action for a Branch on mount. The order of the
 * checks mirrors the recovery cascade the canvas applied inline:
 *
 *  - `creating` is handled first and on its own: with a `sandboxName` the create
 *    pipeline resumes; without one the VM never existed, so it's unrecoverable.
 *  - any other status is a reconnect candidate: skip it if it never had a
 *    sandbox, fail to `repo-missing` if its Repo is gone, otherwise reconnect.
 *
 * The `reconnect` action carries the Repo and ref precisely so the controller
 * can Recreate (never silently reclone) when the resume fails — see ADR 0005.
 */
export function resolveReconnect(
  agent: BranchData,
  repo: RepoData | undefined
): ReconnectAction {
  if (agent.status === "creating") {
    if (!agent.sandboxName) return { kind: "unrecoverable" }
    return {
      kind: "resume-create",
      sandboxName: agent.sandboxName,
      branchId: agent.id,
      branch: agent.ref,
      repoId: agent.repoId,
    }
  }

  if (!agent.sandboxName) return { kind: "none" }
  if (!repo) return { kind: "repo-missing" }

  return {
    kind: "reconnect",
    sandboxName: agent.sandboxName,
    repo,
    ref: agent.ref,
  }
}
