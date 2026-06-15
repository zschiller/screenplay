import type { BranchData, RepoData } from "@/lib/types"

/**
 * Branch Actions — the pure routing decision behind the Branch menu's
 * git / sandbox-lifecycle family, the sibling of `lib/branch/recovery`. It
 * encodes ADR 0005's conflict-risk rule as one testable function: deterministic
 * git → a direct server **action**; can-conflict git → the **Engine** (walked
 * through conversationally); the restart / recreate family → a **recovery** that
 * cycles the Sandbox. Before this module the rule lived only as the shape of
 * several inline handlers, untestable except through React.
 *
 * {@link routeBranchAction} takes the action kind plus the agent / repo
 * snapshots and returns a {@link BranchActionRoute} discriminated union; the
 * thin `useBranchActions` controller applies each variant — `engine` →
 * `dispatchPrompt` (the Agent-prompt seam), `action` → `createPullRequestAction`
 * + the PR source-of-truth write, `recovery` → the matching
 * `lib/branch/recovery` runner. React-free, Yjs-free, network-free.
 *
 * Scope is the ADR 0005 family only — rebase, create PR, restart dev server,
 * restart sandbox, recreate. The canvas-navigation handlers that sit beside them
 * (play, add-frame, show-routes) are a different concern and are not routed here.
 */

/** A Branch menu action in the ADR 0005 git / sandbox-lifecycle family. */
export type BranchActionKind =
  | "rebase"
  | "create-pr"
  | "restart-dev-server"
  | "restart-sandbox"
  | "recreate"

/** Which `lib/branch/recovery` runner a `recovery` route dispatches to. */
export type RecoveryKind = "dev-server" | "sandbox" | "recreate"

/**
 * How a Branch action routes by conflict risk (ADR 0005):
 *
 *  - `engine` — a prompt to dispatch to the agent, so conflicts are resolved
 *    conversationally (Rebase on the default branch).
 *  - `action` — a deterministic server action with no model turn (Create PR).
 *  - `recovery` — cycle the Sandbox via the named recovery runner.
 *  - `none` — the action can't run (missing Sandbox / branch).
 */
export type BranchActionRoute =
  | { kind: "none" }
  | { kind: "engine"; prompt: string }
  | { kind: "action"; action: "create-pr" }
  | { kind: "recovery"; recovery: RecoveryKind }

/** The Branch / Repo slices the routing reads — {@link BranchData} /
 *  {@link RepoData} satisfy these structurally. */
export interface BranchActionInput {
  agent: Pick<BranchData, "sandboxName" | "ref"> | undefined
  repo: Pick<RepoData, "defaultBranch"> | undefined
}

/**
 * Route a Branch menu action by conflict risk. A missing Sandbox yields `none`
 * for every action (the menu item acts on an agent whose VM is gone); rebase
 * additionally needs the branch ref and the repo (it rebases onto the repo's
 * default branch).
 */
export function routeBranchAction(
  action: BranchActionKind,
  { agent, repo }: BranchActionInput
): BranchActionRoute {
  if (!agent?.sandboxName) return { kind: "none" }

  switch (action) {
    case "rebase": {
      // Can-conflict git → the Engine, walked through conversationally.
      if (!agent.ref || !repo) return { kind: "none" }
      return {
        kind: "engine",
        prompt: `Rebase this branch onto the latest \`origin/${repo.defaultBranch}\`. Fetch first, then rebase. If conflicts come up, walk me through them before resolving.`,
      }
    }
    case "create-pr":
      // Deterministic git → a direct server action, no model turn.
      return { kind: "action", action: "create-pr" }
    case "restart-dev-server":
      return { kind: "recovery", recovery: "dev-server" }
    case "restart-sandbox":
      return { kind: "recovery", recovery: "sandbox" }
    case "recreate":
      return { kind: "recovery", recovery: "recreate" }
  }
}
