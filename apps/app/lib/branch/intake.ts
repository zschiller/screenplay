import type { TabKind } from "@/lib/types"

/**
 * Branch Intake — the order-independent decisions behind the Repo → Branch →
 * Sandbox lifecycle, lifted out of `components/canvas/canvas.tsx` (PRD #562).
 *
 * The lifecycle's *orchestration* (clone the Repo → create the Branch record →
 * provision the Sandbox → seed a default tab → seed an eager Frame, and on
 * teardown capture the Sandbox names before the Y.Doc records go) lives in the
 * `useBranchIntake` controller, because the create flow has real data
 * dependencies — the provisioned Sandbox name only exists once the Sandbox
 * Provider returns — so there is deliberately no single all-encompassing pure
 * "intake plan."
 *
 * What *is* pure are the two sub-decisions the controller applies:
 *
 *  - the **teardown plan** ({@link planRepoTeardown} / {@link planBranchTeardown})
 *    — given the current Branch collection and a removed Repo or Branch id (plus
 *    the delete-on-remote flag), which Sandbox names to tear down and which
 *    remote branch refs to delete; and
 *  - the **seed plan** ({@link planBranchSeed}) — given a freshly-created Branch,
 *    which default tab kind and which eager Frame to seed.
 *
 * Both are React-free and Yjs-free: they take plain values and return plain
 * values, so they are asserted directly in `intake.test.ts` with no React, no
 * live Sandbox, and no Y.Doc.
 */

/**
 * The slice of a Branch the teardown plan reads. {@link BranchData} satisfies it
 * structurally; only these fields are touched, so the seam stays narrow.
 */
export interface IntakeBranch {
  id: string
  /** Which Repo owns this Branch — the key the Repo teardown filters on. */
  repoId: string
  /** The Sandbox backing the Branch; "" when none was ever provisioned. */
  sandboxName: string
  /** The git ref (branch name) to delete on the remote, when requested. */
  ref: string
}

/** Options that gate the destructive remote-delete path. */
export interface TeardownOptions {
  /**
   * Also delete the affected branches on the git remote. The controller awaits
   * these deletes and fails loud on the first failure (a partial teardown must
   * not pass silently); a Sandbox teardown is always fire-and-forget.
   */
  deleteOnRemote: boolean
}

/**
 * The teardown plan: which Sandboxes to tear down and which remote branch refs
 * to delete. The controller captures this *before* removing the Y.Doc records,
 * so a Sandbox never outlives its Branch.
 */
export interface TeardownPlan {
  /** Sandbox names to tear down (fire-and-forget). */
  sandboxNames: string[]
  /** Branch refs to delete on the remote — empty unless `deleteOnRemote`. */
  remoteRefs: string[]
}

/**
 * Plan the teardown for removing a whole Repo: every Branch the Repo owns
 * contributes its Sandbox (when provisioned) and, when delete-on-remote is
 * requested, its ref. A Branch with no Sandbox or no ref contributes nothing on
 * that axis.
 */
export function planRepoTeardown(
  repoId: string,
  branches: readonly IntakeBranch[],
  options: TeardownOptions
): TeardownPlan {
  const owned = branches.filter((b) => b.repoId === repoId)
  return {
    sandboxNames: owned.map((b) => b.sandboxName).filter(Boolean),
    remoteRefs: options.deleteOnRemote
      ? owned.map((b) => b.ref).filter(Boolean)
      : [],
  }
}

/**
 * Plan the teardown for removing a single Branch. A missing Branch (it vanished
 * out from under the menu before the click landed) plans nothing.
 */
export function planBranchTeardown(
  branchId: string,
  branches: readonly IntakeBranch[],
  options: TeardownOptions
): TeardownPlan {
  const branch = branches.find((b) => b.id === branchId)
  if (!branch) return { sandboxNames: [], remoteRefs: [] }
  return {
    sandboxNames: branch.sandboxName ? [branch.sandboxName] : [],
    remoteRefs: options.deleteOnRemote && branch.ref ? [branch.ref] : [],
  }
}

/** Per-Branch input to the seed plan. */
export interface BranchSeedInput {
  /** The freshly-created Branch's id. */
  branchId: string
  /**
   * Optional Frame label. The bulk New-Workspace flow labels each Frame from
   * the prompt; single creates omit it and fall back to the Frame default.
   */
  label?: string
  /**
   * True when the Branch was created with a Chat Session already seeded (a
   * prompted New-Workspace row). Its tab is already present, so the default tab
   * is not seeded on top.
   */
  hasSeededChat: boolean
  /** The operator's preferred default tab kind (chat | terminal). */
  defaultTabKind: TabKind
}

/**
 * The seed plan: the default tab to seed (or none) and the eager Frame to seed.
 * The controller performs the writes — the tab through the Tab Pool's seed entry
 * and the Frame through the Canvas Operation seam.
 */
export interface BranchSeedPlan {
  /**
   * The default tab to seed, or `null` when the Branch already has a seeded
   * Chat Session (a prompted row) — so the Tab Pool is never empty when the
   * Branch opens, and a prompted row is never double-seeded.
   */
  tab: { branchId: string; kind: TabKind } | null
  /**
   * The eager Frame to seed: a positioned, identifiable placeholder the canvas
   * shows before the dev server is ready.
   */
  frame: { agentId: string; label?: string }
}

/**
 * Plan a freshly-created Branch's seeds. The eager Frame is always seeded; the
 * default tab is seeded only when no Chat Session was seeded with the Branch.
 */
export function planBranchSeed(input: BranchSeedInput): BranchSeedPlan {
  return {
    tab: input.hasSeededChat
      ? null
      : { branchId: input.branchId, kind: input.defaultTabKind },
    frame: { agentId: input.branchId, label: input.label },
  }
}
