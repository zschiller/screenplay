import { describe, expect, it } from "vitest"

import {
  buildClaudeCodeAuthArgv,
  buildClaudeCodeInstallAndAuthArgv,
  buildClaudeCodeInstallCommand,
  CLAUDE_CODE_INSTALL_PACKAGE,
} from "@/lib/host-tool/claude-code-install-command"
import type { HostFacts } from "@/lib/agent/harnesses/types"

/** Build host facts stating just `npmPresent`; brew/arch don't affect this path. */
function facts(npmPresent: boolean): HostFacts {
  return { npmPresent, brewPresent: false, arch: "arm64" }
}

describe("buildClaudeCodeInstallCommand", () => {
  it("npm present → npm install -g @anthropic-ai/claude-code", () => {
    expect(buildClaudeCodeInstallCommand(facts(true))).toBe(
      `npm install -g ${CLAUDE_CODE_INSTALL_PACKAGE}`
    )
  })

  it("no npm → the vendor's own curl … | bash installer (never dead-ends)", () => {
    const cmd = buildClaudeCodeInstallCommand(facts(false))
    expect(cmd).toBe("curl -fsSL https://claude.ai/install.sh | bash")
  })

  it("neither path invokes sudo", () => {
    expect(buildClaudeCodeInstallCommand(facts(true))).not.toMatch(/\bsudo\b/)
    expect(buildClaudeCodeInstallCommand(facts(false))).not.toMatch(/\bsudo\b/)
  })
})

describe("buildClaudeCodeInstallAndAuthArgv", () => {
  it("runs the install, then chains straight into the sign-in in one sh -c", () => {
    const argv = buildClaudeCodeInstallAndAuthArgv(facts(true))
    expect(argv[0]).toBe("sh")
    expect(argv[1]).toBe("-c")
    expect(argv[2]).toBe(
      `npm install -g ${CLAUDE_CODE_INSTALL_PACKAGE} && ${buildClaudeCodeAuthArgv().join(" ")}`
    )
  })

  it("chains the npm-free install ahead of the sign-in for a host without npm", () => {
    const script = buildClaudeCodeInstallAndAuthArgv(facts(false))[2]!
    expect(script).toContain(buildClaudeCodeInstallCommand(facts(false)))
    // Auth is chained after the install with && — a failed install never reaches
    // the sign-in.
    expect(script.endsWith(`&& ${buildClaudeCodeAuthArgv().join(" ")}`)).toBe(
      true
    )
  })
})
