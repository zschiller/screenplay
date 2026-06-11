import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { lookupStableDevUrl } from "@/lib/sandbox/portless"

/**
 * Exercises the route lookup against a real on-disk state dir in portless's
 * own format (`proxy.port`, the `proxy.tls` marker, `routes.json`), via the
 * `PORTLESS_STATE_DIR` override the CLI itself honors. The route table is
 * read through portless's exported `RouteStore`, so these fixtures are the
 * same files a live daemon writes.
 */
describe("lookupStableDevUrl", () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-state-"))
    vi.stubEnv("PORTLESS_STATE_DIR", dir)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const writeState = (opts: {
    proxyPort?: number
    tls?: boolean
    routes?: { hostname: string; port: number; pid: number }[]
  }) => {
    if (opts.proxyPort !== undefined) {
      fs.writeFileSync(path.join(dir, "proxy.port"), String(opts.proxyPort))
    }
    if (opts.tls) fs.writeFileSync(path.join(dir, "proxy.tls"), "1")
    if (opts.routes) {
      fs.writeFileSync(
        path.join(dir, "routes.json"),
        JSON.stringify(opts.routes)
      )
    }
  }

  it("returns the named URL for the route matching the dev port", async () => {
    writeState({
      proxyPort: 1355,
      // pid 0 is portless's "always alive" sentinel — keeps the fixture
      // independent of which PIDs exist on the test host.
      routes: [
        { hostname: "feat-x.myapp.localhost", port: 53000, pid: 0 },
        { hostname: "other.localhost", port: 53010, pid: 0 },
      ],
    })

    await expect(lookupStableDevUrl(53000)).resolves.toBe(
      "http://feat-x.myapp.localhost:1355"
    )
  })

  it("formats an https URL when the daemon's TLS marker is present", async () => {
    writeState({
      proxyPort: 443,
      tls: true,
      routes: [{ hostname: "feat-x.myapp.localhost", port: 53000, pid: 0 }],
    })

    // 443 is the protocol default, so the port is omitted.
    await expect(lookupStableDevUrl(53000)).resolves.toBe(
      "https://feat-x.myapp.localhost"
    )
  })

  it("returns null when no route matches the dev port", async () => {
    writeState({
      proxyPort: 1355,
      routes: [{ hostname: "other.localhost", port: 53010, pid: 0 }],
    })

    await expect(lookupStableDevUrl(53000)).resolves.toBeNull()
  })

  it("returns null when the daemon never wrote its state", async () => {
    // Empty dir: no proxy.port, no routes.json.
    await expect(lookupStableDevUrl(53000)).resolves.toBeNull()
  })

  it("filters out routes whose owning process is dead", async () => {
    // A route registered by a long-gone `portless run` must not surface as a
    // live URL. PID 2^22 is above Linux's default pid_max, so nothing real
    // can own it.
    writeState({
      proxyPort: 1355,
      routes: [
        { hostname: "stale.myapp.localhost", port: 53000, pid: 4194304 },
      ],
    })

    await expect(lookupStableDevUrl(53000)).resolves.toBeNull()
  })
})
