import { describe, expect, it, vi } from "vitest"

import { claudeCodeHarness } from "@/lib/agent/harnesses/claude-code"
import type {
  AvailableHarness,
  HarnessResolver,
} from "@/lib/agent/harnesses/availability"
import type { Harness, HarnessProcessRunner } from "@/lib/agent/harnesses/types"
import { runHostModel } from "@/lib/agent/host-model"

/**
 * `runHostModel` is the desktop model-call seam (#674): a one-shot prompt run
 * through the first detected chat-capable harness's print mode (`claude -p`)
 * over an injected process runner. These tests drive it with a **fake resolver**
 * and a **fake runner** — no real subprocess — and pin its contract: it shells
 * the right `-p` argv against the right harness on success, and collapses
 * **every** uncertainty (no harness, no print mode, spawn failure, non-zero
 * exit, timeout, empty output) to `null`. Prior art: the harness process-runner
 * tests that drive `probeClaudeCodeAuth` with a fake runner.
 */

/** A resolver that lists exactly `harnesses` as available (installed, auth unprobed). */
function resolverListing(harnesses: Harness[]): HarnessResolver {
  const available: AvailableHarness[] = harnesses.map((harness) => ({
    harness,
    status: { installed: true, authenticated: null },
  }))
  return { list: async () => available, invalidate() {} }
}

/** A chat-capable harness (has an `acpAdapter`) with no print mode. */
const noPrintHarness: Harness = { ...claudeCodeHarness, printModel: undefined }

/** A print-capable harness that is NOT chat-capable (no `acpAdapter`). */
const terminalOnlyHarness: Harness = { ...claudeCodeHarness, acpAdapter: null }

describe("runHostModel", () => {
  it("shells the first chat-capable harness's `-p` argv and returns its stdout", async () => {
    const run = vi.fn<HarnessProcessRunner>(async () => ({
      exitCode: 0,
      stdout: "fix-login\nFix Login\n",
    }))

    const text = await runHostModel("please fix the login", {
      resolver: resolverListing([claudeCodeHarness]),
      run,
    })

    expect(text).toBe("fix-login\nFix Login")
    // The exact print-mode argv: the CLI binary, `-p`, then the prompt as one arg.
    expect(run).toHaveBeenCalledWith("claude", ["-p", "please fix the login"])
  })

  it("returns null when no chat-capable harness is detected", async () => {
    const run = vi.fn<HarnessProcessRunner>()
    expect(
      await runHostModel("hi", { resolver: resolverListing([]), run })
    ).toBeNull()
    // Nothing to shell — the runner is never touched.
    expect(run).not.toHaveBeenCalled()
  })

  it("skips a terminal-only harness (not chat-capable) and returns null", async () => {
    const run = vi.fn<HarnessProcessRunner>()
    expect(
      await runHostModel("hi", {
        resolver: resolverListing([terminalOnlyHarness]),
        run,
      })
    ).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it("returns null when the chosen harness has no print mode", async () => {
    const run = vi.fn<HarnessProcessRunner>()
    expect(
      await runHostModel("hi", {
        resolver: resolverListing([noPrintHarness]),
        run,
      })
    ).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it("returns null on a spawn failure (the CLI binary isn't there)", async () => {
    const run: HarnessProcessRunner = async () => {
      throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })
    }
    expect(
      await runHostModel("hi", {
        resolver: resolverListing([claudeCodeHarness]),
        run,
      })
    ).toBeNull()
  })

  it("returns null on a non-zero exit", async () => {
    const run: HarnessProcessRunner = async () => ({
      exitCode: 1,
      stdout: "not signed in",
    })
    expect(
      await runHostModel("hi", {
        resolver: resolverListing([claudeCodeHarness]),
        run,
      })
    ).toBeNull()
  })

  it("returns null on empty / whitespace-only output", async () => {
    const run: HarnessProcessRunner = async () => ({
      exitCode: 0,
      stdout: "  \n",
    })
    expect(
      await runHostModel("hi", {
        resolver: resolverListing([claudeCodeHarness]),
        run,
      })
    ).toBeNull()
  })

  it("returns null when the CLI hangs past the timeout", async () => {
    // A runner that never resolves — the timeout must win and yield null.
    const run: HarnessProcessRunner = () => new Promise(() => {})
    const text = await runHostModel("hi", {
      resolver: resolverListing([claudeCodeHarness]),
      run,
      timeoutMs: 10,
    })
    expect(text).toBeNull()
  })

  it("returns null when the resolver itself throws (degrade, never propagate)", async () => {
    const resolver: HarnessResolver = {
      list: async () => {
        throw new Error("host probe blew up")
      },
      invalidate() {},
    }
    expect(await runHostModel("hi", { resolver })).toBeNull()
  })
})
