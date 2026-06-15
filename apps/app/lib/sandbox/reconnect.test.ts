import { describe, expect, it } from "vitest"

import { type ReconnectAction, resolveReconnect } from "@/lib/sandbox/reconnect"
import type { BranchData, RepoData } from "@/lib/types"

// Plain fixtures — no React, no Y.Doc. `resolveReconnect` is pure: a bare
// snapshot of a Branch and its (already-looked-up) Repo in, the single recovery
// action out. These lock in every branch of the mount-time recovery cascade and
// the expired-snapshot → Recreate rule (ADR 0005), so the controller's apply and
// any future tweak to the cascade stay honest. We assert observable behaviour
// (the action chosen), never how the canvas component is wired.

/** A running Branch with a live sandbox — the steady-state reconnect case. */
function branch(overrides: Partial<BranchData> = {}): BranchData {
  return {
    id: "branch-1",
    repoId: "repo-1",
    sandboxName: "sandbox-1",
    gitUrl: "https://github.com/octocat/hello-world.git",
    ref: "feature/x",
    previewDomain: "preview.example.com",
    port: 3000,
    status: "running",
    createdAt: 0,
    ...overrides,
  }
}

const repo = {
  id: "repo-1",
  cloneUrl: "https://github.com/octocat/hello-world.git",
  devServerPort: 3000,
} as RepoData

describe("resolveReconnect — creating recovery", () => {
  it("resumes the create pipeline for a creating Branch that has a sandbox", () => {
    const action = resolveReconnect(
      branch({ status: "creating", sandboxName: "sandbox-1" }),
      repo
    )

    expect(action).toEqual<ReconnectAction>({
      kind: "resume-create",
      sandboxName: "sandbox-1",
      branchId: "branch-1",
      branch: "feature/x",
      repoId: "repo-1",
    })
  })

  it("marks a creating Branch with no sandbox unrecoverable — the VM never existed", () => {
    const action = resolveReconnect(
      branch({ status: "creating", sandboxName: "" }),
      repo
    )

    expect(action).toEqual<ReconnectAction>({ kind: "unrecoverable" })
  })

  it("treats creating-with-a-sandbox as resume even when the Repo is gone — resume is the server's job, not a local provision", () => {
    const action = resolveReconnect(
      branch({ status: "creating", sandboxName: "sandbox-1" }),
      undefined
    )

    expect(action.kind).toBe("resume-create")
  })
})

describe("resolveReconnect — reconnect candidates", () => {
  it("reconnects a running Branch with a resolvable Repo", () => {
    const action = resolveReconnect(branch({ status: "running" }), repo)

    expect(action).toEqual<ReconnectAction>({
      kind: "reconnect",
      sandboxName: "sandbox-1",
      repo,
      ref: "feature/x",
    })
  })

  it("reconnects a starting Branch interrupted mid-restart", () => {
    const action = resolveReconnect(branch({ status: "starting" }), repo)

    expect(action.kind).toBe("reconnect")
  })

  it("reports repo-missing when the sandbox's Repo is gone — there's no source to provision from", () => {
    const action = resolveReconnect(branch({ status: "running" }), undefined)

    expect(action).toEqual<ReconnectAction>({ kind: "repo-missing" })
  })

  it("does nothing for a non-creating Branch that never had a sandbox", () => {
    const action = resolveReconnect(
      branch({ status: "stopped", sandboxName: "" }),
      repo
    )

    expect(action).toEqual<ReconnectAction>({ kind: "none" })
  })
})

describe("resolveReconnect — expired-snapshot → Recreate rule (ADR 0005)", () => {
  // A failed resume on an expired snapshot must Recreate from git, never
  // silently reclone or strand the user at "stopped". That apply lives in the
  // controller, but the rule is encoded *here*: the reconnect action carries the
  // sandbox name, Repo, and ref — exactly the inputs `recreateSandbox` needs —
  // so Recreate is the only wired failure path.
  it("carries the recreate inputs (sandboxName, repo, ref) on the reconnect action", () => {
    const action = resolveReconnect(branch({ status: "running" }), repo)

    expect(action.kind).toBe("reconnect")
    if (action.kind !== "reconnect") return
    expect(action.sandboxName).toBe("sandbox-1")
    expect(action.repo).toBe(repo)
    expect(action.ref).toBe("feature/x")
  })
})
