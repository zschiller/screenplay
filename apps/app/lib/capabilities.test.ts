import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

// The profile is read once at module load, so each case stubs the env and
// imports a fresh copy.
async function load(env: Record<string, string | undefined>) {
  vi.resetModules()
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  return import("./capabilities")
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

const BACKENDS = [
  "SANDBOX_BACKEND",
  "SCREENPLAY_DB",
  "BLOB_STORE",
  "AGENT_ENGINE",
  "NEXT_PUBLIC_YJS_HOST",
] as const

/** Every backend switch a build would see with nothing set in its env. */
function backendsOf(caps: Awaited<ReturnType<typeof load>>) {
  return Object.fromEntries(
    BACKENDS.map((name) => [name, caps.backendSwitch(name, {})])
  )
}

describe("build profiles", () => {
  it("hosted: accounts and the multi-user surface, every hosted backend", async () => {
    const caps = await load({ NEXT_PUBLIC_SCREENPLAY_PROFILE: "hosted" })
    expect(caps.buildProfile).toBe("hosted")
    expect(caps.buildIdentity).toBe("account")
    expect(caps.multiUserSurface).toBe(true)
    expect(caps.macShell).toBe(false)
    expect(caps.viewers).toBe(false)
    expect(backendsOf(caps)).toEqual({
      SANDBOX_BACKEND: undefined,
      SCREENPLAY_DB: undefined,
      BLOB_STORE: undefined,
      AGENT_ENGINE: undefined,
      NEXT_PUBLIC_YJS_HOST: undefined,
    })
    expect(caps.yjsHostDefault).toBeUndefined()
  })

  it("desktop: the host in the Mac shell, alone, on local backends", async () => {
    const caps = await load({ NEXT_PUBLIC_SCREENPLAY_PROFILE: "desktop" })
    expect(caps.buildProfile).toBe("desktop")
    expect(caps.buildIdentity).toBe("host")
    expect(caps.multiUserSurface).toBe(false)
    expect(caps.macShell).toBe(true)
    expect(caps.viewers).toBe(false)
    expect(backendsOf(caps)).toEqual({
      SANDBOX_BACKEND: "local",
      SCREENPLAY_DB: "pglite",
      BLOB_STORE: "local-fs",
      AGENT_ENGINE: "external",
      NEXT_PUBLIC_YJS_HOST: "local",
    })
    expect(caps.yjsHostDefault).toBe("local")
  })

  it("headless: the host with viewers and the multi-user surface, no Mac shell", async () => {
    const caps = await load({ NEXT_PUBLIC_SCREENPLAY_PROFILE: "headless" })
    expect(caps.buildProfile).toBe("headless")
    expect(caps.buildIdentity).toBe("host")
    expect(caps.multiUserSurface).toBe(true)
    expect(caps.macShell).toBe(false)
    expect(caps.viewers).toBe(true)
    expect(backendsOf(caps)).toEqual({
      SANDBOX_BACKEND: "local",
      SCREENPLAY_DB: "pglite",
      BLOB_STORE: "local-fs",
      AGENT_ENGINE: "external",
      NEXT_PUBLIC_YJS_HOST: "local",
    })
    expect(caps.yjsHostDefault).toBe("local")
  })

  it("is hosted when nothing is set", async () => {
    const caps = await load({
      NEXT_PUBLIC_SCREENPLAY_PROFILE: undefined,
      NEXT_PUBLIC_SCREENPLAY_LOCAL: undefined,
    })
    expect(caps.buildProfile).toBe("hosted")
  })

  it("still reads the older local flag as desktop", async () => {
    const caps = await load({
      NEXT_PUBLIC_SCREENPLAY_PROFILE: undefined,
      NEXT_PUBLIC_SCREENPLAY_LOCAL: "1",
    })
    expect(caps.buildProfile).toBe("desktop")
  })

  it("refuses an unknown profile instead of guessing", async () => {
    await expect(
      load({ NEXT_PUBLIC_SCREENPLAY_PROFILE: "shared-box" })
    ).rejects.toThrow('Unknown NEXT_PUBLIC_SCREENPLAY_PROFILE "shared-box"')
  })

  it("lets a switch set in the env win over the profile's", async () => {
    const caps = await load({ NEXT_PUBLIC_SCREENPLAY_PROFILE: "desktop" })
    expect(caps.backendSwitch("SCREENPLAY_DB", { SCREENPLAY_DB: "neon" })).toBe(
      "neon"
    )
  })
})

describe("desktop.env", () => {
  it("sets the desktop profile and agrees with its backend switches", async () => {
    const text = readFileSync(
      join(__dirname, "../../desktop/desktop.env"),
      "utf8"
    )
    const env = Object.fromEntries(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => line.split("=", 2) as [string, string])
    )
    expect(env.NEXT_PUBLIC_SCREENPLAY_PROFILE).toBe("desktop")
    const { PROFILE_BACKENDS } = await load({})
    for (const [name, value] of Object.entries(PROFILE_BACKENDS.desktop)) {
      expect(env[name], name).toBe(value)
    }
  })
})
