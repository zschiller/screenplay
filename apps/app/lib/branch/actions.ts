import type { BranchData } from "@/lib/types"

/**
 * Branch Actions — the pure routing decision behind the Branch menu's
 * git / sandbox-lifecycle family, the sibling of `lib/branch/recovery`. It
 * encodes ADR 0005's conflict-risk rule as one testable function: deterministic
 * git → a direct server **action**; the restart / recreate family → a
 * **recovery** that cycles the Sandbox. Can-conflict git (the **Engine** route)
 * has no menu item: the chat menu's Rebase went, so a rebase is asked for in
 * the chat. Before this module the rule lived only as the shape of
 * several inline handlers, untestable except through React.
 *
 * {@link routeBranchAction} takes the action kind plus the agent / repo
 * snapshots and returns a {@link BranchActionRoute} discriminated union; the
 * thin `useBranchActions` controller applies each variant — `action` →
 * `createPullRequestAction`
 * + the PR source-of-truth write, `recovery` → the matching
 * `lib/branch/recovery` runner. React-free, Yjs-free, network-free.
 *
 * Scope is the ADR 0005 family only — create PR, restart dev server,
 * restart sandbox, recreate. The canvas-navigation handlers that sit beside them
 * (play, add-frame, show-routes) are a different concern and are not routed here.
 */

/** A Branch menu action in the ADR 0005 git / sandbox-lifecycle family. */
export type BranchActionKind =
  "create-pr" | "restart-dev-server" | "restart-sandbox" | "recreate"

/** Which `lib/branch/recovery` runner a `recovery` route dispatches to. */
export type RecoveryKind = "dev-server" | "sandbox" | "recreate"

/**
 * How a Branch action routes by conflict risk (ADR 0005):
 *
 *  - `action` — a deterministic server action with no model turn (Create PR).
 *  - `recovery` — cycle the Sandbox via the named recovery runner.
 *  - `none` — the action can't run (missing Sandbox / branch).
 */
export type BranchActionRoute =
  | { kind: "none" }
  | { kind: "action"; action: "create-pr" }
  | { kind: "recovery"; recovery: RecoveryKind }

/** The Branch slice the routing reads — {@link BranchData} satisfies it
 *  structurally. */
export interface BranchActionInput {
  agent: Pick<BranchData, "sandboxName"> | undefined
}

/**
 * Route a Branch menu action by conflict risk. A missing Sandbox yields `none`
 * for every action (the menu item acts on an agent whose VM is gone).
 */
export function routeBranchAction(
  action: BranchActionKind,
  { agent }: BranchActionInput
): BranchActionRoute {
  if (!agent?.sandboxName) return { kind: "none" }

  switch (action) {
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
