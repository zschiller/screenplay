import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  createPreviewExposure,
  loopbackExposure,
} from "@/lib/preview-exposure/builtins"

describe("loopback", () => {
  it("binds 127.0.0.1 and loads each port at http://localhost, as the Mac app does", async () => {
    const exposure = loopbackExposure()
    expect(exposure.bind).toEqual({ host: "127.0.0.1" })
    expect(await exposure.expose(51234)).toEqual({
      browserOrigin: "http://localhost:51234",
    })
  })

  it("takes a port range, for a fixed list of forwarded ports", () => {
    const exposure = createPreviewExposure({
      use: "loopback",
      ports: { from: 20000, to: 20009 },
    })
    expect(exposure.bind).toEqual({
      host: "127.0.0.1",
      ports: { from: 20000, to: 20009 },
    })
  })
})

describe("url-template", () => {
  it("returns each port's origin and sign-in URL from its pattern", async () => {
    const exposure = createPreviewExposure({
      use: "url-template",
      origin: "https://{port}-box.corp.example/",
      signInUrl: "https://{port}-box.corp.example/login",
      ports: { from: 20000, to: 20199 },
    })
    expect(await exposure.expose(20003)).toEqual({
      browserOrigin: "https://20003-box.corp.example",
      signInUrl: "https://20003-box.corp.example/login",
    })
  })

  it("binds every interface by default, so an outside proxy reaches the listeners", () => {
    const exposure = createPreviewExposure({
      use: "url-template",
      origin: "https://{port}-box.corp.example",
    })
    expect(exposure.bind).toEqual({ host: "0.0.0.0" })
    expect(
      createPreviewExposure({
        use: "url-template",
        origin: "https://{port}-box.corp.example",
        bindHost: "10.0.0.5",
      }).bind.host
    ).toBe("10.0.0.5")
  })

  it("omits the sign-in URL when none is configured", async () => {
    const exposure = createPreviewExposure({
      use: "url-template",
      origin: "https://box.corp.example:{port}",
    })
    expect(await exposure.expose(443)).toEqual({
      browserOrigin: "https://box.corp.example",
    })
  })
})

describe("command", () => {
  let dir: string
  let log: string
  let script: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "preview-exposure-"))
    log = path.join(dir, "log")
    script = path.join(dir, "expose.sh")
    // A stand-in for `tailscale serve` or a company tool: it records its
    // arguments, and fails for port 1.
    await fs.writeFile(
      script,
      `#!/bin/sh\necho "$@" >> "${log}"\n[ "$2" = 1 ] && { echo "port 1 is taken" >&2; exit 3; }\nexit 0\n`,
      { mode: 0o755 }
    )
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("runs the expose and release commands with the port filled in", async () => {
    const exposure = createPreviewExposure({
      use: "command",
      exposeCommand: [script, "expose", "{port}"],
      releaseCommand: [script, "release", "{port}"],
      origin: "https://box.tailnet.ts.net:{port}",
    })
    expect(exposure.bind).toEqual({ host: "127.0.0.1" })
    expect(await exposure.expose(8443)).toEqual({
      browserOrigin: "https://box.tailnet.ts.net:8443",
    })
    await exposure.release(8443)
    expect(await fs.readFile(log, "utf8")).toBe("expose 8443\nrelease 8443\n")
  })

  it("fails the expose with the command's own message", async () => {
    const exposure = createPreviewExposure({
      use: "command",
      exposeCommand: [script, "expose", "{port}"],
      origin: "https://box.example:{port}",
    })
    await expect(exposure.expose(1)).rejects.toThrow("port 1 is taken")
  })

  it("never throws from a failed release", async () => {
    const exposure = createPreviewExposure({
      use: "command",
      exposeCommand: [script, "expose", "{port}"],
      releaseCommand: [script, "release", "{port}"],
      origin: "https://box.example:{port}",
    })
    await expect(exposure.release(1)).resolves.toBeUndefined()
  })
})

describe("createPreviewExposure", () => {
  it("names the built-ins when the id is unknown", () => {
    expect(() => createPreviewExposure({ use: "tailscale" })).toThrow(
      'Unknown preview exposure "tailscale". Built-ins: loopback, url-template, command.'
    )
  })

  it("names the option that's wrong", () => {
    expect(() =>
      createPreviewExposure({ use: "url-template", origin: "https://box" })
    ).toThrow('Preview exposure "url-template": origin must contain {port}')
    expect(() =>
      createPreviewExposure({
        use: "loopback",
        ports: { from: 20010, to: 20000 },
      })
    ).toThrow("ports")
    expect(() =>
      createPreviewExposure({ use: "loopback", origni: "x" })
    ).toThrow('Preview exposure "loopback"')
    expect(() =>
      createPreviewExposure({
        use: "command",
        origin: "https://box.example:{port}",
      })
    ).toThrow("exposeCommand")
  })
})
