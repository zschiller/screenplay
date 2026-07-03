import { describe, expect, it } from "vitest"

import {
  buildGhInstallAndAuthArgv,
  buildGhInstallCommand,
  GH_INSTALL_VERSION,
} from "@/lib/host-tool/gh-install-command"

describe("buildGhInstallCommand", () => {
  it("brew present → brew install gh", () => {
    expect(buildGhInstallCommand(true)).toBe("brew install gh")
  })

  it("brew absent → curls the macOS_arm64 build into ~/.local/bin", () => {
    const cmd = buildGhInstallCommand(false)
    // The official Apple-Silicon asset, pinned by version.
    expect(cmd).toContain(
      `https://github.com/cli/cli/releases/download/v${GH_INSTALL_VERSION}/gh_${GH_INSTALL_VERSION}_macOS_arm64.zip`
    )
    // Lands the binary on the sidecar's augmented PATH…
    expect(cmd).toContain('"$HOME/.local/bin/gh"')
    // …and marks it executable.
    expect(cmd).toContain('chmod +x "$HOME/.local/bin/gh"')
  })

  it("the binary fallback never invokes sudo", () => {
    expect(buildGhInstallCommand(false)).not.toMatch(/\bsudo\b/)
  })

  it("the binary fallback is a single && chain (a failed step stops it)", () => {
    const cmd = buildGhInstallCommand(false)
    expect(cmd).toContain("&&")
    // No unconditional `;` sequencing that would run later steps after a failure.
    expect(cmd).not.toContain(";")
  })
})

describe("buildGhInstallAndAuthArgv", () => {
  it("runs the install, then chains straight into gh auth login in one sh -c", () => {
    const argv = buildGhInstallAndAuthArgv(true)
    expect(argv[0]).toBe("sh")
    expect(argv[1]).toBe("-c")
    const script = argv[2]!
    expect(script).toBe(
      "brew install gh && gh auth login --web --git-protocol https --scopes repo"
    )
  })

  it("carries the binary-fallback install ahead of the auth for a brew-less host", () => {
    const script = buildGhInstallAndAuthArgv(false)[2]!
    expect(script).toContain(buildGhInstallCommand(false))
    // Auth is chained after the install with &&, so a failed install never
    // reaches the sign-in.
    expect(
      script.endsWith(
        "&& gh auth login --web --git-protocol https --scopes repo"
      )
    ).toBe(true)
  })

  it("never invokes sudo on either path", () => {
    expect(buildGhInstallAndAuthArgv(false)[2]!).not.toMatch(/\bsudo\b/)
    expect(buildGhInstallAndAuthArgv(true)[2]!).not.toMatch(/\bsudo\b/)
  })
})
