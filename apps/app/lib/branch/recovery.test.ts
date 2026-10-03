import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SandboxActionResult } from "@/lib/sandbox/run"
import type { RepoData } from "@/lib/types"

import {
  type BranchRecoveryDeps,
  type RecoveryAgent,
  type RecoveryPatch,
  markDone,
  recreate,
  reopen,
  restartDevServer,
  restartSandbox,
  runDevServer,
  startWorkspace,
  stopDevServer,
} from "@/lib/branch/recovery"

// The recovery verbs await the sandbox lifecycle actions through the module
// seam. Fakes stand in so we drive success / failure per test and assert which
// fn each verb invokes — no provider, no VM.
const lifecycle = vi.hoisted(() => ({
  restartDevServer: vi.fn(),
  stopDevServer: vi.fn(),
  restartSandbox: vi.fn(),
  recreateSandbox: vi.fn(),
  reconnectSandbox: vi.fn(),
  stopWorkspaceSandbox: vi.fn(),
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
  toasts: Array<{
    kind: "success" | "error"
    message: string
    description?: string
  }>
} {
  const patches: Array<{ id: string; patch: RecoveryPatch }> = []
  const toasts: Array<{
    kind: "success" | "error"
    message: string
    description?: string
  }> = []
  return {
    roomId: "room-1",
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
  lifecycle.stopDevServer.mockReset()
  lifecycle.restartSandbox.mockReset()
  lifecycle.recreateSandbox.mockReset()
  lifecycle.reconnectSandbox.mockReset()
  lifecycle.stopWorkspaceSandbox.mockReset()
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

    await expect(recreate("branch-1", deps)).resolves.toEqual({ ok: true })

    expect(lifecycle.recreateSandbox).toHaveBeenCalledWith(
      "sandbox-1",
      REPO,
      "feature/x",
      "room-1"
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

    // The outcome carries the failure so the Recreate confirm can show it.
    await expect(recreate("branch-1", deps)).resolves.toEqual({
      ok: false,
      error: "clone failed",
    })

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
  it("treats a thrown sandbox call as a failure instead of leaving it starting", async () => {
    lifecycle.recreateSandbox.mockRejectedValue(new Error("fetch failed"))
    const deps = makeDeps()

    await expect(recreate("branch-1", deps)).resolves.toEqual({
      ok: false,
      error: "fetch failed",
    })
    expect(deps.patches.map((p) => p.patch.status)).toEqual([
      "starting",
      "error",
    ])
  })
})

describe("restartDevServer (Dev Server Restart, thin path)", () => {
  it("never flips status — only stamps the launch and toasts — on success", async () => {
    lifecycle.restartDevServer.mockResolvedValue({
      success: true,
      value: { previewDomain: "https://x" },
    })
    const deps = makeDeps()

    await restartDevServer("branch-1", deps)

    expect(lifecycle.restartDevServer).toHaveBeenCalledWith("sandbox-1", REPO)
    expect(deps.patches).toEqual([
      {
        id: "branch-1",
        patch: {
          devServerStoppedAt: undefined,
          devServerLaunchedAt: expect.any(Number),
        },
      },
    ])
    expect(deps.patches.some((p) => "status" in p.patch)).toBe(false)
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

    expect(deps.patches.some((p) => "status" in p.patch)).toBe(false)
    expect(deps.toasts[0]).toMatchObject({
      kind: "error",
      message: "Couldn't restart dev server",
      description: "not running",
    })
  })
})

describe("stopDevServer (Dev Server Stop, #1342)", () => {
  it("records the stop for everyone, then stops the dev server", async () => {
    lifecycle.stopDevServer.mockResolvedValue({ success: true })
    const deps = makeDeps()

    await stopDevServer("branch-1", deps, 42)

    expect(lifecycle.stopDevServer).toHaveBeenCalledWith("sandbox-1")
    expect(deps.patches).toEqual([
      { id: "branch-1", patch: { devServerStoppedAt: 42 } },
    ])
    expect(deps.toasts).toEqual([])
  })

  it("takes the stop back and says so when it fails", async () => {
    lifecycle.stopDevServer.mockResolvedValue({
      success: false,
      error: "boom",
    })
    const deps = makeDeps()

    await stopDevServer("branch-1", deps, 42)

    expect(deps.patches.map((p) => p.patch)).toEqual([
      { devServerStoppedAt: 42 },
      { devServerStoppedAt: undefined },
    ])
    expect(deps.toasts).toEqual([
      {
        kind: "error",
        message: "Couldn't stop dev server",
        description: "boom",
      },
    ])
  })
})

describe("runDevServer (Dev Server Run, #1342)", () => {
  const stopped = { ...AGENT, devServerStoppedAt: 7 }

  it("clears the stop and relaunches through the restart path, quietly", async () => {
    lifecycle.restartDevServer.mockResolvedValue({
      success: true,
      value: { previewDomain: "https://x" },
    })
    const deps = makeDeps({ findAgent: () => stopped })

    await runDevServer("branch-1", deps)

    expect(lifecycle.restartDevServer).toHaveBeenCalledWith("sandbox-1", REPO)
    expect(deps.patches.map((p) => p.patch)).toEqual([
      {
        devServerStoppedAt: undefined,
        devServerLaunchedAt: expect.any(Number),
      },
    ])
    expect(deps.toasts).toEqual([])
  })

  it("puts the stop back when the launch fails", async () => {
    lifecycle.restartDevServer.mockResolvedValue({
      success: false,
      error: "Sandbox is not running",
    })
    const deps = makeDeps({ findAgent: () => stopped })

    await runDevServer("branch-1", deps)

    expect(deps.patches.at(-1)?.patch).toEqual({ devServerStoppedAt: 7 })
    expect(deps.toasts).toEqual([
      {
        kind: "error",
        message: "Couldn't run dev server",
        description: "Sandbox is not running",
      },
    ])
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
      {
        id: "branch-1",
        patch: { status: "error", error: "Workspace not found" },
      },
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

describe("startWorkspace", () => {
  it("restarts the sandbox on the hosted build", async () => {
    lifecycle.restartSandbox.mockResolvedValue(ok)
    const deps = makeDeps()
    await startWorkspace("branch-1", deps, { local: false })
    expect(lifecycle.restartSandbox).toHaveBeenCalledWith("sandbox-1", REPO)
    expect(lifecycle.restartDevServer).not.toHaveBeenCalled()
    expect(deps.patches.at(-1)?.patch.status).toBe("running")
  })

  it("restarts the dev server locally, flipping status so the frame follows", async () => {
    lifecycle.restartDevServer.mockResolvedValue({
      success: true,
      value: { previewDomain: "https://local.preview" },
    })
    const deps = makeDeps()
    await startWorkspace("branch-1", deps, { local: true })
    expect(lifecycle.restartSandbox).not.toHaveBeenCalled()
    expect(deps.patches.map((p) => p.patch.status)).toEqual([
      "starting",
      "running",
    ])
    expect(deps.patches.at(-1)?.patch).toMatchObject({
      sandboxName: "sandbox-1",
      previewDomain: "https://local.preview",
      error: "",
    })
  })

  it("lands a failed local restart back on error with the reason", async () => {
    lifecycle.restartDevServer.mockResolvedValue({
      success: false,
      error: "Sandbox is not running",
    })
    const deps = makeDeps()
    await startWorkspace("branch-1", deps, { local: true })
    expect(deps.patches.at(-1)?.patch).toMatchObject({
      status: "error",
      error: "Sandbox is not running",
    })
    expect(deps.toasts.at(-1)).toMatchObject({
      kind: "error",
      message: "Couldn't restart dev server",
    })
  })
})

describe("markDone and reopen (#976)", () => {
  it("marks the Workspace Done and stopped, then spins its sandbox down", async () => {
    lifecycle.stopWorkspaceSandbox.mockResolvedValue({
      success: true,
      value: undefined,
    })
    const deps = makeDeps()
    await markDone("branch-1", deps, 1234)
    expect(deps.patches).toEqual([
      {
        id: "branch-1",
        patch: {
          doneAt: 1234,
          status: "stopped",
          statusMessage: "",
          error: "",
        },
      },
    ])
    expect(lifecycle.stopWorkspaceSandbox).toHaveBeenCalledWith("sandbox-1")
    expect(deps.toasts).toEqual([])
  })

  it("stays Done when the stop fails", async () => {
    lifecycle.stopWorkspaceSandbox.mockRejectedValue(new Error("gone"))
    const deps = makeDeps()
    await markDone("branch-1", deps, 1)
    expect(deps.patches).toHaveLength(1)
    expect(deps.toasts).toEqual([])
  })

  it("reopens: clears Done, then starts the sandbox through reconnect", async () => {
    lifecycle.reconnectSandbox.mockResolvedValue(ok)
    const deps = makeDeps()
    await reopen("branch-1", deps)
    expect(deps.patches[0]).toEqual({
      id: "branch-1",
      patch: { doneAt: undefined },
    })
    expect(deps.patches.slice(1).map((p) => p.patch.status)).toEqual([
      "starting",
      "running",
    ])
    expect(lifecycle.reconnectSandbox).toHaveBeenCalledWith("sandbox-1", REPO)
    expect(deps.toasts).toEqual([])
  })

  it("lands a failed reopen on error, out of the Done section", async () => {
    lifecycle.reconnectSandbox.mockResolvedValue({
      success: false,
      error: "expired",
    } satisfies SandboxResult)
    const deps = makeDeps()
    await reopen("branch-1", deps)
    expect(deps.patches.at(-1)?.patch).toMatchObject({
      status: "error",
      error: "expired",
    })
    expect(deps.toasts).toEqual([
      {
        kind: "error",
        message: "Couldn't reopen workspace",
        description: "expired",
      },
    ])
  })
})
