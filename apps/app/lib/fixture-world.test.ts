import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * The Fixture World switch (issue #716). Its whole job is to be *narrow*: only
 * the local build, only the explicit opt-in value. Both halves matter — it
 * opens the first-run setup gate and stops Sandbox Reconnect, so a build that
 * entered fixture mode by accident would ship an app that never checks the host.
 *
 * `isFixtureWorld` is a module-eval-time const (so the bundler can eliminate the
 * guarded branches), which is why each case stubs the env and re-imports.
 */
describe("fixture-world switch", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function load(env: Record<string, string | undefined>) {
    vi.resetModules()
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value as string)
    }
    return (await import("./fixture-world")).isFixtureWorld
  }

  it("is on for the local build with the explicit opt-in", async () => {
    expect(
      await load({
        NEXT_PUBLIC_SCREENPLAY_LOCAL: "1",
        NEXT_PUBLIC_SCREENPLAY_FIXTURE_WORLD: "1",
      })
    ).toBe(true)
  })

  it("is off on the hosted build even when the env asks for it", async () => {
    expect(
      await load({
        NEXT_PUBLIC_SCREENPLAY_LOCAL: undefined,
        NEXT_PUBLIC_SCREENPLAY_FIXTURE_WORLD: "1",
      })
    ).toBe(false)
  })

  it("is off for the local build without the opt-in", async () => {
    expect(
      await load({
        NEXT_PUBLIC_SCREENPLAY_LOCAL: "1",
        NEXT_PUBLIC_SCREENPLAY_FIXTURE_WORLD: undefined,
      })
    ).toBe(false)
  })

  it.each(["", "0", "true", "yes"])(
    "treats %o as off — only the exact value 1 opts in",
    async (value) => {
      expect(
        await load({
          NEXT_PUBLIC_SCREENPLAY_LOCAL: "1",
          NEXT_PUBLIC_SCREENPLAY_FIXTURE_WORLD: value,
        })
      ).toBe(false)
    }
  )
})

describe("fixture world → the first-run setup gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("opens the gate without probing the host at all", async () => {
    vi.resetModules()
    vi.stubEnv("NEXT_PUBLIC_SCREENPLAY_LOCAL", "1")
    vi.stubEnv("NEXT_PUBLIC_SCREENPLAY_FIXTURE_WORLD", "1")

    // Both host probes throw: a capture container has no coding CLI and no
    // GitHub, so the short-circuit must happen *before* either is reached, not
    // merely swallow their failures.
    const listHarnessSetupStatus = vi.fn(() => {
      throw new Error("must not probe the host in the fixture world")
    })
    const getGitHubLocalStatus = vi.fn(() => {
      throw new Error("must not probe the host in the fixture world")
    })
    vi.doMock("@/lib/agent/harnesses/setup-actions", () => ({
      listHarnessSetupStatus,
    }))
    vi.doMock("@/lib/github-local/actions", () => ({ getGitHubLocalStatus }))

    const { getLocalSetupGateStatus } =
      await import("./local-setup/gate-status")
    const { isLocalSetupComplete } = await import("./local-setup/is-complete")

    const status = await getLocalSetupGateStatus()
    expect(status).toEqual({ harnessSatisfied: true, githubSatisfied: true })
    expect(listHarnessSetupStatus).not.toHaveBeenCalled()
    expect(getGitHubLocalStatus).not.toHaveBeenCalled()
    // The release predicate the gate folds this through must agree, with no
    // GitHub skip cookie in play.
    expect(isLocalSetupComplete({ ...status, githubSkipped: false })).toBe(true)

    vi.doUnmock("@/lib/agent/harnesses/setup-actions")
    vi.doUnmock("@/lib/github-local/actions")
  })
})
