import { describe, expect, it } from "vitest"

import {
  buildCodexAuthArgv,
  buildCodexInstallAndAuthArgv,
  buildCodexInstallCommand,
  CODEX_INSTALL_PACKAGE,
} from "@/lib/host-tool/codex-install-command"
import type { HostFacts } from "@/lib/agent/harnesses/types"

/** Build host facts from the branch inputs; `arch` defaults to the arm64 target. */
function facts(partial: Partial<HostFacts>): HostFacts {
  return { npmPresent: false, brewPresent: false, arch: "arm64", ...partial }
}

describe("buildCodexInstallCommand", () => {
  it("brew present → brew install codex", () => {
    // Homebrew wins whenever it's present, even if npm is too.
    expect(buildCodexInstallCommand(facts({ brewPresent: true }))).toBe(
      "brew install codex"
    )
    expect(
      buildCodexInstallCommand(facts({ brewPresent: true, npmPresent: true }))
    ).toBe("brew install codex")
  })

  it("no brew, npm present → npm i -g @openai/codex", () => {
    expect(buildCodexInstallCommand(facts({ npmPresent: true }))).toBe(
      `npm i -g ${CODEX_INSTALL_PACKAGE}`
    )
  })

  it("neither brew nor npm → the macOS-arm64 release binary into ~/.local/bin", () => {
    const cmd = buildCodexInstallCommand(
      facts({ brewPresent: false, npmPresent: false, arch: "arm64" })
    )
    // The Apple-silicon release asset, landed in ~/.local/bin (already on PATH).
    expect(cmd).toContain("codex-aarch64-apple-darwin.tar.gz")
    expect(cmd).toContain('"$HOME/.local/bin"')
    expect(cmd).toContain("mv")
  })

  it("uses the x86_64 asset on an Intel host", () => {
    const cmd = buildCodexInstallCommand(facts({ arch: "x64" }))
    expect(cmd).toContain("codex-x86_64-apple-darwin.tar.gz")
  })

  it("no branch invokes sudo", () => {
    expect(buildCodexInstallCommand(facts({ brewPresent: true }))).not.toMatch(
      /\bsudo\b/
    )
    expect(buildCodexInstallCommand(facts({ npmPresent: true }))).not.toMatch(
      /\bsudo\b/
    )
    expect(buildCodexInstallCommand(facts({}))).not.toMatch(/\bsudo\b/)
  })
})

describe("buildCodexInstallAndAuthArgv", () => {
  it("runs the install, then chains straight into codex login in one sh -c", () => {
    const argv = buildCodexInstallAndAuthArgv(facts({ npmPresent: true }))
    expect(argv[0]).toBe("sh")
    expect(argv[1]).toBe("-c")
    expect(argv[2]).toBe(
      `npm i -g ${CODEX_INSTALL_PACKAGE} && ${buildCodexAuthArgv().join(" ")}`
    )
  })

  it("chains the npm-free binary install ahead of the sign-in", () => {
    const script = buildCodexInstallAndAuthArgv(facts({}))[2]!
    expect(script).toContain(buildCodexInstallCommand(facts({})))
    // Auth is chained after the install with && — a failed install never reaches
    // the sign-in.
    expect(script.endsWith(`&& ${buildCodexAuthArgv().join(" ")}`)).toBe(true)
  })
})
