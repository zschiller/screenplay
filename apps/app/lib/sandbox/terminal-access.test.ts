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

let savedAuth: string | undefined
let savedBackend: string | undefined
beforeEach(() => {
  savedAuth = process.env.TERMINAL_AUTH
  savedBackend = process.env.SANDBOX_BACKEND
})
afterEach(() => {
  if (savedAuth === undefined) delete process.env.TERMINAL_AUTH
  else process.env.TERMINAL_AUTH = savedAuth
  if (savedBackend === undefined) delete process.env.SANDBOX_BACKEND
  else process.env.SANDBOX_BACKEND = savedBackend
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
