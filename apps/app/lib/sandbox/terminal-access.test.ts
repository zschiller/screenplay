import { createHmac } from "crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The local pass-through strategy resolves the sidecar terminal server's port
// through a dynamic import. Mock the module so the fold stays pure — no node-pty
// server booted — while still exercising the real URL the client is handed.
const LOCAL_SERVER_PORT = 54321
vi.mock("@/lib/terminal/local/server", () => ({
  ensureLocalTerminalServer: vi.fn(async () => ({ port: LOCAL_SERVER_PORT })),
}))

import { TERMINAL_PORT } from "@/lib/sandbox/provision-internals"
import { selectTerminalAccessStrategy } from "@/lib/sandbox/terminal-access"
import type { TerminalCredential } from "@/lib/sandbox/terminal-credential"
import type { SandboxInstance } from "@/lib/sandbox/types"

// A gated request's inputs. Only the surface the strategies read is real: a
// Sandbox `name` + `domain(port)`; the credential is a recognizable token so a
// pass-through that's meant to ignore it can be shown to leave it out.
const credential: TerminalCredential = {
  token: "recognizable-credential-token",
  expiresAt: 0,
}
const binding = { roomId: "room-1", sessionId: "sess-1" }
const sandbox = {
  name: "branch-42",
  domain: (port: number) => `https://fake-${port}.example.com`,
} as SandboxInstance

const resolveWith = (env: { terminalAuth?: string; backend?: string }) => {
  if (env.terminalAuth === undefined) delete process.env.TERMINAL_AUTH
  else process.env.TERMINAL_AUTH = env.terminalAuth
  if (env.backend === undefined) delete process.env.SANDBOX_BACKEND
  else process.env.SANDBOX_BACKEND = env.backend
  return selectTerminalAccessStrategy().resolve({
    sandbox,
    credential,
    binding,
  })
}

// The `ttyd-credential` secret is HMAC'd under TERMINAL_AUTH_SECRET (already
// required for the minted room-member credential), so pin a known key and derive
// the expected `user:pass` the same way the strategy does.
const TERMINAL_SECRET = "test-terminal-auth-secret"
const expectedBasicAuth = (sandboxName: string) =>
  `screenplay:${createHmac("sha256", TERMINAL_SECRET)
    .update(sandboxName)
    .digest("base64url")}`

let savedAuth: string | undefined
let savedBackend: string | undefined
let savedSecret: string | undefined
beforeEach(() => {
  savedAuth = process.env.TERMINAL_AUTH
  savedBackend = process.env.SANDBOX_BACKEND
  savedSecret = process.env.TERMINAL_AUTH_SECRET
  process.env.TERMINAL_AUTH_SECRET = TERMINAL_SECRET
})
afterEach(() => {
  if (savedAuth === undefined) delete process.env.TERMINAL_AUTH
  else process.env.TERMINAL_AUTH = savedAuth
  if (savedBackend === undefined) delete process.env.SANDBOX_BACKEND
  else process.env.SANDBOX_BACKEND = savedBackend
  if (savedSecret === undefined) delete process.env.TERMINAL_AUTH_SECRET
  else process.env.TERMINAL_AUTH_SECRET = savedSecret
})

describe("selectTerminalAccessStrategy — hosted backend", () => {
  it("defaults to bearer when TERMINAL_AUTH is unset: the public domain(port) URL, no basicAuth", async () => {
    const access = await resolveWith({
      terminalAuth: undefined,
      backend: undefined,
    })

    // Byte-for-byte today's shape: the ttyd daemon's public URL and nothing else.
    expect(access).toEqual({ url: `https://fake-${TERMINAL_PORT}.example.com` })
  })

  it("treats an empty TERMINAL_AUTH the same as unset (bearer)", async () => {
    const access = await resolveWith({ terminalAuth: "", backend: "vercel" })

    expect(access).toEqual({ url: `https://fake-${TERMINAL_PORT}.example.com` })
  })

  it("selects bearer for an explicit TERMINAL_AUTH=bearer", async () => {
    const access = await resolveWith({
      terminalAuth: "bearer",
      backend: "vercel",
    })

    expect(access).toEqual({ url: `https://fake-${TERMINAL_PORT}.example.com` })
  })

  it("throws at selection for an unknown TERMINAL_AUTH, mirroring the provider fold", () => {
    process.env.SANDBOX_BACKEND = "vercel"
    process.env.TERMINAL_AUTH = "proxy"

    expect(() => selectTerminalAccessStrategy()).toThrow(
      /Unknown TERMINAL_AUTH/
    )
  })
})

describe("selectTerminalAccessStrategy — ttyd-credential", () => {
  it("resolves to the same public URL plus the per-Sandbox basicAuth secret", async () => {
    const access = await resolveWith({
      terminalAuth: "ttyd-credential",
      backend: "vercel",
    })

    // Same URL the client always connects to — the secret moves out of the URL
    // and into `basicAuth`, which the client presents on the WS handshake.
    expect(access.url).toBe(`https://fake-${TERMINAL_PORT}.example.com`)
    expect(access.basicAuth).toBe(expectedBasicAuth(sandbox.name))
    // The URL itself never carries the secret — that is the whole point.
    expect(access.url).not.toContain(access.basicAuth)
  })

  it("launches the daemon with a matching --credential (same value the client is handed)", () => {
    process.env.SANDBOX_BACKEND = "vercel"
    process.env.TERMINAL_AUTH = "ttyd-credential"

    const strategy = selectTerminalAccessStrategy()
    // The launch path reads `daemonCredential`; it must equal the `basicAuth`
    // the client presents, so the daemon validates exactly what it enforces.
    expect(strategy.daemonCredential?.(sandbox.name)).toBe(
      expectedBasicAuth(sandbox.name)
    )
  })

  it("derives a distinct secret per Sandbox so a torn-down Branch's is invalid", () => {
    process.env.SANDBOX_BACKEND = "vercel"
    process.env.TERMINAL_AUTH = "ttyd-credential"

    const strategy = selectTerminalAccessStrategy()
    expect(strategy.daemonCredential?.("branch-a")).not.toBe(
      strategy.daemonCredential?.("branch-b")
    )
  })

  it("stays the local pass-through under ttyd-credential on the local backend", async () => {
    // The local backend wins over TERMINAL_AUTH: no ttyd daemon exists, so no
    // credential is minted and the localhost origin is returned untouched.
    const access = await resolveWith({
      terminalAuth: "ttyd-credential",
      backend: "local",
    })

    expect(access).toEqual({
      url: `http://localhost:${LOCAL_SERVER_PORT}/?sandbox=branch-42`,
    })
    expect(access.basicAuth).toBeUndefined()
  })
})

describe("selectTerminalAccessStrategy — local backend", () => {
  it("resolves to the 127.0.0.1 pass-through, ignoring the minted credential", async () => {
    const access = await resolveWith({
      terminalAuth: "bearer",
      backend: "local",
    })

    // The client is told to connect to the localhost sidecar for this Sandbox…
    expect(access).toEqual({
      url: `http://localhost:${LOCAL_SERVER_PORT}/?sandbox=branch-42`,
    })
    // …and the decorative credential never rides along in the URL.
    expect(access.url).not.toContain(credential.token)
  })

  it("honors the legacy `worktree` backend value too", async () => {
    const access = await resolveWith({
      terminalAuth: undefined,
      backend: "worktree",
    })

    expect(access.url).toBe(
      `http://localhost:${LOCAL_SERVER_PORT}/?sandbox=branch-42`
    )
  })

  it("stays the pass-through even for a TERMINAL_AUTH the hosted fold would reject", async () => {
    // Selection must not throw: the local backend wins over TERMINAL_AUTH, so a
    // value that is unknown on the hosted path is simply irrelevant here.
    process.env.SANDBOX_BACKEND = "local"
    process.env.TERMINAL_AUTH = "proxy"

    expect(() => selectTerminalAccessStrategy()).not.toThrow()
    const access = await selectTerminalAccessStrategy().resolve({
      sandbox,
      credential,
      binding,
    })
    expect(access.url).toBe(
      `http://localhost:${LOCAL_SERVER_PORT}/?sandbox=branch-42`
    )
  })
})
