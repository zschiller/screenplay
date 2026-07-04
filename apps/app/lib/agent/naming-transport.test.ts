import { describe, expect, it, vi } from "vitest"

import { runNamingModel } from "@/lib/agent/naming-transport"

/**
 * `runNamingModel` hides the per-backend model transport behind one call. The
 * desktop routing (#674) is the new behavior: with no hosted key it shells the
 * user's own harness CLI via the injected `hostModel` seam, folding the system
 * guidance into the single print-mode prompt, and passes its `null` straight
 * through so the caller falls back. Injected `isDesktop` + `hostModel` keep the
 * routing testable without a subprocess or env.
 */
describe("runNamingModel (desktop routing)", () => {
  it("shells the host model with the system guidance folded into the prompt", async () => {
    const hostModel = vi.fn(async () => "fix-login\nFix Login")

    const text = await runNamingModel({
      system: "SYS",
      prompt: "fix the login",
      isDesktop: true,
      hostModel,
    })

    expect(text).toBe("fix-login\nFix Login")
    expect(hostModel).toHaveBeenCalledWith("SYS\n\nfix the login")
  })

  it("passes the host model's null straight through (no model reachable)", async () => {
    const text = await runNamingModel({
      system: "SYS",
      prompt: "fix the login",
      isDesktop: true,
      hostModel: async () => null,
    })
    expect(text).toBeNull()
  })

  it("never touches the hosted provider transport on desktop", async () => {
    // A resolving hostModel means the hosted `generateText` branch is skipped —
    // the desktop build has no provider key to reach.
    const hostModel = vi.fn(async () => "Name")
    await runNamingModel({
      system: "SYS",
      prompt: "p",
      isDesktop: true,
      hostModel,
    })
    expect(hostModel).toHaveBeenCalledOnce()
  })
})
