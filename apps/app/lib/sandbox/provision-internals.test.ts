import { afterEach, describe, expect, it } from "vitest"

import { sessionLeader } from "@/lib/sandbox/provision-internals"

// `sessionLeader` keys off `SANDBOX_BACKEND` (via `isLocalSandboxBackend`) and
// `process.platform`. Stash and restore both so each case is isolated.
const originalBackend = process.env.SANDBOX_BACKEND
const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  })
}

afterEach(() => {
  if (originalBackend === undefined) delete process.env.SANDBOX_BACKEND
  else process.env.SANDBOX_BACKEND = originalBackend
  setPlatform(originalPlatform)
})

describe("sessionLeader", () => {
  // The bug: macOS has no `setsid` binary, so a literal `setsid` prefix died
  // with "command not found" (swallowed by the launch's `>/dev/null 2>&1`) and
  // the dev server / proxy / terminal never started — the Logs panel showed
  // only the `$ <script>` header. On the local backend running on macOS the
  // prefix must therefore NOT be a bare `setsid` command.
  it("shims setsid with Perl on the local backend on macOS", () => {
    process.env.SANDBOX_BACKEND = "local"
    setPlatform("darwin")

    const prefix = sessionLeader()
    // Not a bare, unguarded `setsid` token that the shell would try to exec.
    expect(prefix.startsWith("setsid")).toBe(false)
    // It opens a new session via Perl's POSIX::setsid, then execs the real argv.
    expect(prefix).toContain("perl")
    expect(prefix).toContain("POSIX::setsid()")
    expect(prefix).toContain("exec(@ARGV)")
  })

  it("keeps native setsid on a Linux local host (the binary exists there)", () => {
    process.env.SANDBOX_BACKEND = "worktree"
    setPlatform("linux")

    expect(sessionLeader()).toBe("setsid")
  })

  it("keeps native setsid on the hosted backend (always a Linux VM)", () => {
    delete process.env.SANDBOX_BACKEND
    // Even on a macOS host the hosted commands run in a Linux VM, so the host
    // platform is irrelevant — never the Perl shim.
    setPlatform("darwin")

    expect(sessionLeader()).toBe("setsid")
  })
})
