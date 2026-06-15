import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SandboxActionResult } from "@/lib/sandbox/run"
import type { RepoData } from "@/lib/types"

import {
  type BranchRecoveryDeps,
  type RecoveryAgent,
  type RecoveryPatch,
  recreate,
  restartDevServer,
  restartSandbox,
} from "@/lib/branch/recovery"

// The recovery verbs await the sandbox lifecycle actions through the module
// seam. Fakes stand in so we drive success / failure per test and assert which
// fn each verb invokes — no provider, no VM.
const lifecycle = vi.hoisted(() => ({
  restartDevServer: vi.fn(),
  restartSandbox: vi.fn(),
  recreateSandbox: vi.fn(),
}))

vi.mock("@/lib/sandbox/lifecycle", () => lifecycle)

type SandboxResult = SandboxActionResult<{
  sandboxName: string
  previewDomain: string
}>

const AGENT: RecoveryAgent = {
  repoId: "repo-1",
  sandboxName: "sandbox-1",
  previewDomain: "https://old.preview",
  ref: "feature/x",
}

const REPO = { id: "repo-1", devServerPort: 3000 } as unknown as RepoData

/**
 * Build the injected seams plus recorders for what the runner wrote. `patches`
 * captures the status writes in order; `toasts` captures the user-facing copy.
 */
function makeDeps(
  overrides: Partial<BranchRecoveryDeps> = {}
): BranchRecoveryDeps & {
  patches: Array<{ id: string; patch: RecoveryPatch }>
  toasts: Array<{ kind: "success" | "error"; message: string; description?: string }>
} {
  const patches: Array<{ id: string; patch: RecoveryPatch }> = []
  const toasts: Array<{
    kind: "success" | "error"
    message: string
    description?: string
  }> = []
  return {
    findAgent: () => AGENT,
    findRepo: () => REPO,
    patchAgent: (id, patch) => patches.push({ id, patch }),
    toast: {
      success: (message) => toasts.push({ kind: "success", message }),
      error: (message, description) =>
        toasts.push({ kind: "error", message, description }),
    },
    patches,
    toasts,
    ...overrides,
  }
}

const ok: SandboxResult = {
  success: true,
  value: { sandboxName: "sandbox-2", previewDomain: "https://new.preview" },
}

beforeEach(() => {
  lifecycle.restartDevServer.mockReset()
  lifecycle.restartSandbox.mockReset()
  lifecycle.recreateSandbox.mockReset()
})

describe("restartSandbox (Sandbox Restart)", () => {
  it("flips starting → running and toasts on success, invoking restartSandbox", async () => {
    lifecycle.restartSandbox.mockResolvedValue(ok)
    const deps = makeDeps()

    await restartSandbox("branch-1", deps)

    expect(lifecycle.restartSandbox).toHaveBeenCalledWith("sandbox-1", REPO)
    expect(lifecycle.recreateSandbox).not.toHaveBeenCalled()
    expect(deps.patches.map((p) => p.patch.status)).toEqual([
      "starting",
      "running",
    ])
    expect(deps.patches[0].patch.statusMessage).toBe("Restarting sandbox…")
    expect(deps.patches[1].patch).toMatchObject({
      sandboxName: "sandbox-2",
      previewDomain: "https://new.preview",
      status: "running",
    })
    expect(deps.toasts).toEqual([
      { kind: "success", message: "Sandbox restarted" },
    ])
  })

  it("flips starting → error and toasts the error on failure", async () => {
    lifecycle.restartSandbox.mockResolvedValue({
      success: false,
      error: "snapshot miss",
    } satisfies SandboxResult)
    const deps = makeDeps()

    await restartSandbox("branch-1", deps)

    expect(deps.patches.map((p) => p.patch.status)).toEqual([
      "starting",
      "error",
    ])
    expect(deps.patches[1].patch.error).toBe("snapshot miss")
    expect(deps.toasts).toEqual([
      {
        kind: "error",
        message: "Couldn't restart sandbox",
        description: "snapshot miss",
      },
    ])
  })

  it("keeps the old preview when the new VM reports a blank domain", async () => {
    lifecycle.restartSandbox.mockResolvedValue({
      success: true,
      value: { sandboxName: "sandbox-2", previewDomain: "" },
    } satisfies SandboxResult)
    const deps = makeDeps()

    await restartSandbox("branch-1", deps)

    expect(deps.patches[1].patch.previewDomain).toBe("https://old.preview")
  })
})

describe("recreate (Recreate)", () => {
  it("flips starting → running and toasts on success, invoking recreateSandbox with the ref", async () => {
    lifecycle.recreateSandbox.mockResolvedValue(ok)
    const deps = makeDeps()

    await recreate("branch-1", deps)

    expect(lifecycle.recreateSandbox).toHaveBeenCalledWith(
      "sandbox-1",
      REPO,
      "feature/x"
    )
    expect(lifecycle.restartSandbox).not.toHaveBeenCalled()
    expect(deps.patches[0].patch.statusMessage).toBe("Recreating sandbox…")
    expect(deps.patches.map((p) => p.patch.status)).toEqual([
      "starting",
      "running",
    ])
    expect(deps.toasts).toEqual([
      { kind: "success", message: "Sandbox recreated" },
    ])
  })

  it("flips starting → error and toasts the error on failure", async () => {
    lifecycle.recreateSandbox.mockResolvedValue({
      success: false,
      error: "clone failed",
    } satisfies SandboxResult)
    const deps = makeDeps()

    await recreate("branch-1", deps)

    expect(deps.patches.map((p) => p.patch.status)).toEqual([
      "starting",
      "error",
    ])
    expect(deps.toasts[0]).toMatchObject({
      kind: "error",
      message: "Couldn't recreate sandbox",
      description: "clone failed",
    })
  })
})

describe("restartDevServer (Dev Server Restart, thin path)", () => {
  it("never flips status — only toasts — on success, invoking restartDevServer", async () => {
    lifecycle.restartDevServer.mockResolvedValue({
      success: true,
      value: { previewDomain: "https://x" },
    })
    const deps = makeDeps()

    await restartDevServer("branch-1", deps)

    expect(lifecycle.restartDevServer).toHaveBeenCalledWith("sandbox-1", REPO)
    expect(deps.patches).toEqual([])
    expect(deps.toasts).toEqual([
      { kind: "success", message: "Dev server restarted" },
    ])
  })

  it("toasts the error without flipping status on failure", async () => {
    lifecycle.restartDevServer.mockResolvedValue({
      success: false,
      error: "not running",
    })
    const deps = makeDeps()

    await restartDevServer("branch-1", deps)

    expect(deps.patches).toEqual([])
    expect(deps.toasts[0]).toMatchObject({
      kind: "error",
      message: "Couldn't restart dev server",
      description: "not running",
    })
  })
})

describe("guards", () => {
  it("is a silent no-op when the Branch is gone", async () => {
    const deps = makeDeps({ findAgent: () => undefined })

    await restartSandbox("branch-1", deps)
    await recreate("branch-1", deps)
    await restartDevServer("branch-1", deps)

    expect(deps.patches).toEqual([])
    expect(deps.toasts).toEqual([])
    expect(lifecycle.restartSandbox).not.toHaveBeenCalled()
    expect(lifecycle.recreateSandbox).not.toHaveBeenCalled()
    expect(lifecycle.restartDevServer).not.toHaveBeenCalled()
  })

  it("flips Sandbox Restart straight to error when the Repo is missing", async () => {
    const deps = makeDeps({ findRepo: () => undefined })

    await restartSandbox("branch-1", deps)

    expect(deps.patches).toEqual([
      { id: "branch-1", patch: { status: "error", error: "Workspace not found" } },
    ])
    expect(deps.toasts[0]).toMatchObject({
      kind: "error",
      message: "Couldn't restart sandbox",
      description: "Workspace not found",
    })
    expect(lifecycle.restartSandbox).not.toHaveBeenCalled()
  })

  it("reports a missing Repo on the thin path without flipping status", async () => {
    const deps = makeDeps({ findRepo: () => undefined })

    await restartDevServer("branch-1", deps)

    expect(deps.patches).toEqual([])
    expect(deps.toasts[0]).toMatchObject({
      kind: "error",
      message: "Couldn't restart dev server",
      description: "Workspace not found",
    })
    expect(lifecycle.restartDevServer).not.toHaveBeenCalled()
  })
})
