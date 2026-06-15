import { describe, expect, it } from "vitest"

import {
  type IntakeBranch,
  planBranchSeed,
  planBranchTeardown,
  planRepoTeardown,
} from "@/lib/branch/intake"

// A small Branch collection spanning two Repos, with the edge cases the plans
// have to handle: a Branch with no Sandbox (never provisioned) and a Branch with
// no ref (no remote to delete).
const BRANCHES: IntakeBranch[] = [
  { id: "b1", repoId: "r1", sandboxName: "sp-1", ref: "feature/one" },
  { id: "b2", repoId: "r1", sandboxName: "sp-2", ref: "feature/two" },
  // Provisioning never landed: no Sandbox, no ref.
  { id: "b3", repoId: "r1", sandboxName: "", ref: "" },
  // A Sandbox exists but the ref is empty — nothing to delete on the remote.
  { id: "b4", repoId: "r1", sandboxName: "sp-4", ref: "" },
  // A different Repo's Branch — must never be swept up by r1's teardown.
  { id: "b5", repoId: "r2", sandboxName: "sp-5", ref: "feature/five" },
]

describe("planRepoTeardown", () => {
  it("tears down every owned Branch's Sandbox, skipping unprovisioned ones", () => {
    const plan = planRepoTeardown("r1", BRANCHES, { deleteOnRemote: false })
    expect(plan.sandboxNames).toEqual(["sp-1", "sp-2", "sp-4"])
  })

  it("plans no remote deletes when delete-on-remote is off", () => {
    const plan = planRepoTeardown("r1", BRANCHES, { deleteOnRemote: false })
    expect(plan.remoteRefs).toEqual([])
  })

  it("plans remote deletes for owned Branches with a ref when requested", () => {
    const plan = planRepoTeardown("r1", BRANCHES, { deleteOnRemote: true })
    expect(plan.remoteRefs).toEqual(["feature/one", "feature/two"])
  })

  it("never sweeps up another Repo's Branch", () => {
    const plan = planRepoTeardown("r1", BRANCHES, { deleteOnRemote: true })
    expect(plan.sandboxNames).not.toContain("sp-5")
    expect(plan.remoteRefs).not.toContain("feature/five")
  })

  it("plans nothing for a Repo with no Branches", () => {
    const plan = planRepoTeardown("nope", BRANCHES, { deleteOnRemote: true })
    expect(plan).toEqual({ sandboxNames: [], remoteRefs: [] })
  })
})

describe("planBranchTeardown", () => {
  it("tears down just the one Branch's Sandbox", () => {
    const plan = planBranchTeardown("b1", BRANCHES, { deleteOnRemote: false })
    expect(plan).toEqual({ sandboxNames: ["sp-1"], remoteRefs: [] })
  })

  it("plans the remote delete when requested and the Branch has a ref", () => {
    const plan = planBranchTeardown("b2", BRANCHES, { deleteOnRemote: true })
    expect(plan).toEqual({
      sandboxNames: ["sp-2"],
      remoteRefs: ["feature/two"],
    })
  })

  it("plans no Sandbox teardown for an unprovisioned Branch", () => {
    const plan = planBranchTeardown("b3", BRANCHES, { deleteOnRemote: true })
    expect(plan).toEqual({ sandboxNames: [], remoteRefs: [] })
  })

  it("plans no remote delete for a Branch with no ref, even when requested", () => {
    const plan = planBranchTeardown("b4", BRANCHES, { deleteOnRemote: true })
    expect(plan).toEqual({ sandboxNames: ["sp-4"], remoteRefs: [] })
  })

  it("plans nothing for a Branch that vanished before the click landed", () => {
    const plan = planBranchTeardown("gone", BRANCHES, { deleteOnRemote: true })
    expect(plan).toEqual({ sandboxNames: [], remoteRefs: [] })
  })
})

describe("planBranchSeed", () => {
  it("seeds the operator's default tab kind for a bare Branch", () => {
    const plan = planBranchSeed({
      branchId: "b1",
      hasSeededChat: false,
      defaultTabKind: "chat",
    })
    expect(plan.tab).toEqual({ branchId: "b1", kind: "chat" })
  })

  it("honours a terminal default tab kind", () => {
    const plan = planBranchSeed({
      branchId: "b1",
      hasSeededChat: false,
      defaultTabKind: "terminal",
    })
    expect(plan.tab).toEqual({ branchId: "b1", kind: "terminal" })
  })

  it("skips the default tab when a Chat Session was already seeded", () => {
    const plan = planBranchSeed({
      branchId: "b1",
      hasSeededChat: true,
      defaultTabKind: "chat",
    })
    expect(plan.tab).toBeNull()
  })

  it("always seeds an eager Frame, carrying the label through", () => {
    const plan = planBranchSeed({
      branchId: "b1",
      label: "Add login",
      hasSeededChat: true,
      defaultTabKind: "chat",
    })
    expect(plan.frame).toEqual({ agentId: "b1", label: "Add login" })
  })

  it("seeds an unlabelled Frame for a single create", () => {
    const plan = planBranchSeed({
      branchId: "b1",
      hasSeededChat: false,
      defaultTabKind: "chat",
    })
    expect(plan.frame).toEqual({ agentId: "b1", label: undefined })
  })
})
