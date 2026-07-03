import { afterEach, describe, expect, it } from "vitest"
import os from "node:os"

import { WebSocket } from "ws"

import {
  parseConnectionTarget,
  resolveConnectionCwd,
  startLocalTerminalServer,
  type LocalTerminalServer,
} from "@/lib/terminal/local/server"
import { TerminalSessions } from "@/lib/terminal/local/pty"
import {
  decodeServerMessage,
  encodeHandshake,
  encodeInput,
  encodeResize,
  TTYD_SUBPROTOCOL,
} from "@/lib/terminal/ttyd-protocol"

// Drives the whole transport end-to-end — a real `ws` client over the real
// localhost server over a real node-pty — speaking the same wire protocol the
// xterm.js client speaks. This is the node-pty analogue of the ttyd protocol
// spike: echo a marker and read it back, resize and confirm the PTY geometry
// changed, and prove a tab survives a "reload" (socket drop + reconnect).

const SHELL = "/bin/bash"
const decoder = new TextDecoder()

/** A connected client that accumulates decoded OUTPUT and exposes senders. */
interface Client {
  send(frame: Uint8Array): void
  text(): string
  close(): void
  closed: Promise<void>
}

function connect(
  server: LocalTerminalServer,
  sessionKey: string,
  query = "sandbox=test"
): Promise<Client> {
  const url = `ws://127.0.0.1:${server.port}/ws?${query}&arg=${sessionKey}`
  const ws = new WebSocket(url, [TTYD_SUBPROTOCOL])
  let text = ""
  ws.binaryType = "arraybuffer"
  ws.on("message", (data: ArrayBuffer | Buffer) => {
    const bytes =
      data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data)
    const msg = decodeServerMessage(bytes)
    if (msg.type === "output") text += decoder.decode(msg.data)
  })
  const closed = new Promise<void>((resolve) => ws.on("close", () => resolve()))
  return new Promise((resolve, reject) => {
    ws.on("error", reject)
    ws.on("open", () =>
      resolve({
        send: (frame) => ws.send(frame),
        text: () => text,
        close: () => ws.close(),
        closed,
      })
    )
  })
}

async function waitFor(
  predicate: () => boolean,
  { timeout = 4000, step = 25 } = {}
): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("waitFor timed out")
    await new Promise((r) => setTimeout(r, step))
  }
}

describe("startLocalTerminalServer", () => {
  let server: LocalTerminalServer
  let sessions: TerminalSessions

  async function start(): Promise<void> {
    sessions = new TerminalSessions()
    server = await startLocalTerminalServer({
      sessions,
      shell: SHELL,
      // Isolate from the sandbox seam — every connection runs in tmp.
      resolveCwd: async () => os.tmpdir(),
    })
  }

  afterEach(async () => {
    if (sessions) sessions.kill("screenplay-tab")
    if (server) await server.close()
  })

  it("round-trips I/O over the WebSocket after the handshake", async () => {
    await start()
    const client = await connect(server, "screenplay-tab")
    client.send(encodeHandshake({ authToken: "", columns: 80, rows: 24 }))
    client.send(encodeInput("echo WIRE_$((6*7))\r"))
    await waitFor(() => client.text().includes("WIRE_42"))
    expect(client.text()).toContain("WIRE_42")
  })

  it("propagates a RESIZE frame to the real PTY", async () => {
    await start()
    const client = await connect(server, "screenplay-tab")
    client.send(encodeHandshake({ authToken: "", columns: 80, rows: 24 }))

    client.send(encodeInput("stty size\r"))
    await waitFor(() => /\b24 80\b/.test(client.text()))

    client.send(encodeResize(120, 40))
    client.send(encodeInput("stty size\r"))
    await waitFor(() => /\b40 120\b/.test(client.text()))
    expect(client.text()).toMatch(/\b40 120\b/)
  })

  it("survives a reload: reconnecting the same session replays a live PTY", async () => {
    await start()
    const first = await connect(server, "screenplay-tab")
    first.send(encodeHandshake({ authToken: "", columns: 80, rows: 24 }))
    first.send(encodeInput("echo BEFORE_RELOAD\r"))
    await waitFor(() => first.text().includes("BEFORE_RELOAD"))

    // Reload: drop the socket. The PTY must keep running in the sidecar.
    first.close()
    await first.closed
    expect(sessions.has("screenplay-tab")).toBe(true)

    const second = await connect(server, "screenplay-tab")
    second.send(encodeHandshake({ authToken: "", columns: 80, rows: 24 }))
    // The replay buffer redraws the pre-reload output…
    await waitFor(() => second.text().includes("BEFORE_RELOAD"))
    // …and the same shell answers a fresh command.
    second.send(encodeInput("echo AFTER_RELOAD\r"))
    await waitFor(() => second.text().includes("AFTER_RELOAD"))
    expect(second.text()).toContain("AFTER_RELOAD")
  })

  it("rejects a connection that names no session key", async () => {
    await start()
    const url = `ws://127.0.0.1:${server.port}/ws?sandbox=test`
    const ws = new WebSocket(url, [TTYD_SUBPROTOCOL])
    const code = await new Promise<number>((resolve, reject) => {
      ws.on("close", (c) => resolve(c))
      ws.on("error", reject)
    })
    expect(code).toBe(1008)
  })

  it("rejects a connection that names neither a sandbox nor a host session", async () => {
    await start()
    const url = `ws://127.0.0.1:${server.port}/ws?arg=screenplay-tab`
    const ws = new WebSocket(url, [TTYD_SUBPROTOCOL])
    const code = await new Promise<number>((resolve, reject) => {
      ws.on("close", (c) => resolve(c))
      ws.on("error", reject)
    })
    expect(code).toBe(1008)
  })

  it("runs a host session in $HOME with no sandbox required", async () => {
    // A host session names no sandbox; its cwd is the pinned home dir, and the
    // sandbox resolver is never consulted (a host session bypasses it entirely).
    sessions = new TerminalSessions()
    const home = os.tmpdir()
    server = await startLocalTerminalServer({
      sessions,
      shell: SHELL,
      resolveHomeDir: () => home,
      resolveCwd: async () => {
        throw new Error("host session must not resolve a sandbox")
      },
    })
    const client = await connect(server, "screenplay-tab", "host=1")
    client.send(encodeHandshake({ authToken: "", columns: 80, rows: 24 }))
    client.send(encodeInput("pwd\r"))
    await waitFor(() => client.text().includes(home))
    expect(client.text()).toContain(home)
  })
})

describe("resolveConnectionCwd", () => {
  const deps = {
    resolveCwd: async (name: string) => `/worktrees/${name}`,
    homeDir: () => "/home/user",
  }

  it("resolves a host session to the home dir, ignoring the sandbox resolver", async () => {
    const target = parseConnectionTarget(new URLSearchParams("host=1"))
    await expect(
      resolveConnectionCwd(target, {
        ...deps,
        resolveCwd: async () => {
          throw new Error("must not be called")
        },
      })
    ).resolves.toBe("/home/user")
  })

  it("resolves a sandbox session through the seam, unchanged", async () => {
    const target = parseConnectionTarget(
      new URLSearchParams("sandbox=branch-1")
    )
    await expect(resolveConnectionCwd(target, deps)).resolves.toBe(
      "/worktrees/branch-1"
    )
  })

  it("rejects a sandbox session with no sandbox name", async () => {
    const target = parseConnectionTarget(new URLSearchParams(""))
    await expect(resolveConnectionCwd(target, deps)).rejects.toThrow()
  })
})
