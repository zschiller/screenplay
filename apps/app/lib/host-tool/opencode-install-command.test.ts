import { describe, expect, it } from "vitest"

import {
  buildOpencodeAuthArgv,
  buildOpencodeInstallAndAuthArgv,
  buildOpencodeInstallCommand,
  OPENCODE_INSTALL_PACKAGE,
} from "@/lib/host-tool/opencode-install-command"
import type { HostFacts } from "@/lib/agent/harnesses/types"

/** Build host facts stating just `npmPresent`; brew/arch don't affect this path. */
function facts(npmPresent: boolean): HostFacts {
  return { npmPresent, brewPresent: false, arch: "arm64" }
}

describe("buildOpencodeInstallCommand", () => {
  it("npm present → npm install -g opencode-ai (the fallback path)", () => {
    expect(buildOpencodeInstallCommand(facts(true))).toBe(
      `npm install -g ${OPENCODE_INSTALL_PACKAGE}`
    )
  })

  it("no npm → opencode's own curl … | bash installer into ~/.local/bin", () => {
    const cmd = buildOpencodeInstallCommand(facts(false))
    expect(cmd).toBe(
      'OPENCODE_INSTALL_DIR="$HOME/.local/bin" curl -fsSL https://opencode.ai/install | bash'
    )
    // The install dir override lands the binary on the sidecar's augmented PATH,
    // not opencode's own ~/.opencode/bin default.
    expect(cmd).toContain('OPENCODE_INSTALL_DIR="$HOME/.local/bin"')
  })

  it("neither path invokes sudo", () => {
    expect(buildOpencodeInstallCommand(facts(true))).not.toMatch(/\bsudo\b/)
    expect(buildOpencodeInstallCommand(facts(false))).not.toMatch(/\bsudo\b/)
  })
})

describe("buildOpencodeAuthArgv", () => {
  it("is opencode's own interactive provider login, run verbatim in the PTY", () => {
    expect(buildOpencodeAuthArgv()).toEqual(["opencode", "auth", "login"])
  })
})

describe("buildOpencodeInstallAndAuthArgv", () => {
  it("runs the install, then chains straight into the sign-in in one sh -c", () => {
    const argv = buildOpencodeInstallAndAuthArgv(facts(true))
    expect(argv[0]).toBe("sh")
    expect(argv[1]).toBe("-c")
    expect(argv[2]).toBe(
      `npm install -g ${OPENCODE_INSTALL_PACKAGE} && ${buildOpencodeAuthArgv().join(" ")}`
    )
  })

  it("chains the npm-free install ahead of the sign-in for a host without npm", () => {
    const script = buildOpencodeInstallAndAuthArgv(facts(false))[2]!
    expect(script).toContain(buildOpencodeInstallCommand(facts(false)))
    // Auth is chained after the install with && — a failed install never reaches
    // the sign-in.
    expect(script.endsWith(`&& ${buildOpencodeAuthArgv().join(" ")}`)).toBe(
      true
    )
  })
})
