import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { tailscaleExposure } from "@/lib/preview-exposure"

const SIGNED_IN = {
  BackendState: "Running",
  Self: { DNSName: "zacks-mac.tail1234.ts.net." },
  CertDomains: ["zacks-mac.tail1234.ts.net"],
}

describe("tailscale", () => {
  let dir: string
  let log: string
  let status: string
  let cli: string

  /** What `tailscale status --json` prints next. */
  async function setStatus(value: unknown) {
    await fs.writeFile(status, JSON.stringify(value))
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tailscale-exposure-"))
    log = path.join(dir, "log")
    status = path.join(dir, "status.json")
    cli = path.join(dir, "tailscale")
    // A fake `tailscale`: it records every call, prints the status file for
    // `status --json`, refuses to serve port 1, and says "handler does not
    // exist" when turning off port 2, as the real one does for a port it
    // isn't serving.
    await fs.writeFile(
      cli,
      `#!/bin/sh
echo "$@" >> "${log}"
case "$1" in
  status) cat "${status}" ;;
  serve)
    case "$*" in
      *--https=1\\ *) echo "port 1 is taken" >&2; exit 1 ;;
      *--https=2\\ off) echo "error: handler does not exist" >&2; exit 1 ;;
    esac ;;
esac
`,
      { mode: 0o755 }
    )
    await setStatus(SIGNED_IN)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(dir, { recursive: true, force: true })
  })

  const calls = async () =>
    (await fs.readFile(log, "utf8").catch(() => "")).trim().split("\n")

  it("binds 127.0.0.1, for tailscale serve to proxy to", () => {
    expect(tailscaleExposure({ cli: [cli] }).bind).toEqual({
      host: "127.0.0.1",
    })
  })

  it("serves the port in the background over the Mac's tailnet name", async () => {
    const exposure = tailscaleExposure({ cli: [cli] })
    expect(await exposure.expose(51234)).toEqual({
      browserOrigin: "https://zacks-mac.tail1234.ts.net:51234",
    })
    expect(await calls()).toEqual([
      "status --json",
      "serve --bg --yes --https=51234 http://127.0.0.1:51234",
    ])
  })

  it("turns the port's serve off on release", async () => {
    const exposure = tailscaleExposure({ cli: [cli] })
    await exposure.release(51234)
    expect(await calls()).toEqual(["serve --yes --https=51234 off"])
  })

  it("releases a port it isn't serving quietly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(
      tailscaleExposure({ cli: [cli] }).release(2)
    ).resolves.toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it("fails the expose with tailscale serve's own message", async () => {
    await expect(tailscaleExposure({ cli: [cli] }).expose(1)).rejects.toThrow(
      "The preview couldn’t be shared on port 1: port 1 is taken"
    )
  })

  it("tries each CLI in turn, as the Mac app's binary is often not on PATH", async () => {
    const exposure = tailscaleExposure({
      cli: [path.join(dir, "missing"), cli],
    })
    expect((await exposure.expose(8443)).browserOrigin).toBe(
      "https://zacks-mac.tail1234.ts.net:8443"
    )
  })

  it("says so when Tailscale isn't installed", async () => {
    const exposure = tailscaleExposure({ cli: [path.join(dir, "missing")] })
    await expect(exposure.expose(8443)).rejects.toThrow(
      "Tailscale isn’t installed"
    )
    await expect(exposure.release(8443)).resolves.toBeUndefined()
  })

  it("says so when Tailscale isn't signed in or is off, without serving", async () => {
    const exposure = tailscaleExposure({ cli: [cli] })
    await setStatus({ BackendState: "NeedsLogin", Self: { DNSName: "" } })
    await expect(exposure.expose(8443)).rejects.toThrow(
      "Tailscale isn’t signed in"
    )
    await setStatus({ ...SIGNED_IN, BackendState: "Stopped" })
    await expect(exposure.expose(8443)).rejects.toThrow(
      "Tailscale is turned off"
    )
    expect(await calls()).toEqual(["status --json", "status --json"])
  })

  it("says so when the tailnet has no HTTPS certificates, without serving", async () => {
    await setStatus({ ...SIGNED_IN, CertDomains: null })
    await expect(
      tailscaleExposure({ cli: [cli] }).expose(8443)
    ).rejects.toThrow("doesn’t have HTTPS certificates turned on")
    expect(await calls()).toEqual(["status --json"])
  })

  it("says so when Tailscale isn't running", async () => {
    await fs.writeFile(
      cli,
      `#!/bin/sh\necho "failed to connect to local tailscaled" >&2\nexit 1\n`
    )
    await expect(
      tailscaleExposure({ cli: [cli] }).expose(8443)
    ).rejects.toThrow(
      "Tailscale isn’t running: failed to connect to local tailscaled"
    )
  })
})
