import "server-only"

import http from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"

import { WebSocketServer, type WebSocket, type RawData } from "ws"

import {
  decodeClientMessage,
  encodeOutput,
  TTYD_SUBPROTOCOL,
  type TtydClientMessage,
} from "@/lib/terminal/ttyd-protocol"
import {
  getTerminalSessions,
  type SessionHandle,
  type TerminalSessions,
} from "@/lib/terminal/local/pty"

/**
 * The desktop build's local terminal transport: a localhost WebSocket server in
 * the sidecar that bridges the unchanged xterm.js client to a node-pty process
 * (`pty.ts`). It is the no-VM replacement for the hosted build's chain of
 * "ttyd daemon on a forwarded `domain(port)` + bearer-link URL" — there is no
 * public URL and no firewall, just `127.0.0.1`.
 *
 * The bridge speaks the **same** wire protocol the client already drives
 * (`ttyd-protocol.ts`), so swapping the transport touches nothing on the client.
 * Per connection:
 *
 *  1. The URL names a target and carries the client's `?arg=` list — the first
 *     arg is the session key (`screenplay-<tabId>`), any rest are a launch
 *     command (a bare shell when empty). The target is either `?sandbox=<name>`
 *     (run in that Branch's worktree) or `?host=1` (a **host session**: cwd =
 *     `$HOME`, no room / sandbox / membership gate — the desktop-local surface
 *     Settings uses to run `gh auth login` against the host `gh`, ADR 0014).
 *  2. The first frame is the handshake (geometry); it triggers attach to the
 *     session registry, spawning the PTY on first connect or re-attaching to the
 *     live one on a reload.
 *  3. INPUT frames write to the PTY, RESIZE frames resize it, and PTY output is
 *     framed back as OUTPUT.
 */

export interface LocalTerminalServer {
  /** The bound localhost port the client connects to. */
  port: number
  close(): Promise<void>
}

export interface StartOptions {
  /** Port to bind; `0` (default) takes an ephemeral one. Bound to 127.0.0.1. */
  port?: number
  /** Resolve a sandbox name → its worktree dir. Defaults to the sandbox seam. */
  resolveCwd?: (sandboxName: string) => Promise<string>
  /** The cwd for a host session. Defaults to the host `$HOME` (`os.homedir()`);
   *  tests pin it for determinism. */
  resolveHomeDir?: () => string
  /** Registry to attach against. Defaults to the process singleton. */
  sessions?: TerminalSessions
  /** Override the spawned shell (tests pin this; prod uses `$SHELL`). */
  shell?: string
}

/** Default cwd resolver: read the worktree path off the sandbox provider seam. */
async function resolveWorktreeCwd(sandboxName: string): Promise<string> {
  const { sandboxProvider } = await import("@/lib/sandbox")
  const instance = await sandboxProvider.get({ name: sandboxName })
  return instance.worktreePath
}

/** Which kind of session a connection's URL requests, parsed off its query. */
export interface ConnectionTarget {
  /** A host session (cwd `$HOME`, no sandbox); `?host=1`. */
  hostSession: boolean
  /** The sandbox name to run in, when it isn't a host session; `?sandbox=<name>`. */
  sandboxName: string | null
}

/** Read the target off a connection's URL search params. */
export function parseConnectionTarget(
  searchParams: URLSearchParams
): ConnectionTarget {
  return {
    hostSession: searchParams.get("host") === "1",
    sandboxName: searchParams.get("sandbox"),
  }
}

/**
 * The cwd a connection's PTY spawns in. A **host session** runs in `$HOME` with
 * no sandbox — deliberately outside the room/membership gate, safe under the
 * same `127.0.0.1` desktop-local trust boundary the transport already relies on
 * (ADR 0014). A **sandbox session** resolves its worktree through the seam,
 * exactly as before. Pure but for the injected resolvers, so it's unit-testable
 * without a real sandbox or a real socket.
 */
export function resolveConnectionCwd(
  target: ConnectionTarget,
  deps: {
    resolveCwd: (sandboxName: string) => Promise<string>
    homeDir: () => string
  }
): Promise<string> {
  if (target.hostSession) return Promise.resolve(deps.homeDir())
  if (!target.sandboxName) return Promise.reject(new Error("missing sandbox"))
  return deps.resolveCwd(target.sandboxName)
}

/** Normalize a `ws` message (Buffer | Buffer[] | ArrayBuffer) to one Uint8Array. */
function toBytes(raw: RawData): Uint8Array {
  if (Array.isArray(raw)) return new Uint8Array(Buffer.concat(raw))
  if (Buffer.isBuffer(raw)) return new Uint8Array(raw)
  return new Uint8Array(raw as ArrayBuffer)
}

/**
 * Start the local terminal WebSocket server and resolve once it's listening.
 * Returns the bound port and a `close()` that tears the listener down (the PTY
 * sessions outlive it — they're owned by the registry).
 */
export function startLocalTerminalServer(
  opts: StartOptions = {}
): Promise<LocalTerminalServer> {
  const resolveCwd = opts.resolveCwd ?? resolveWorktreeCwd
  const homeDir = opts.resolveHomeDir ?? (() => os.homedir())
  const sessions = opts.sessions ?? getTerminalSessions()

  const httpServer = http.createServer((_req, res) => {
    // This server only serves the WebSocket upgrade; a plain GET is a mistake.
    res.writeHead(426, { "Content-Type": "text/plain" })
    res.end("Upgrade Required")
  })

  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    // Echo back the client's `tty` subprotocol; a browser aborts the handshake
    // if the server doesn't select one of the protocols it offered.
    handleProtocols: (protocols) =>
      protocols.has(TTYD_SUBPROTOCOL) ? TTYD_SUBPROTOCOL : false,
  })

  wss.on("connection", (ws, req) => {
    handleConnection(ws, req.url ?? "/", {
      resolveCwd,
      homeDir,
      sessions,
      shell: opts.shell,
    })
  })

  return new Promise((resolve) => {
    httpServer.listen(opts.port ?? 0, "127.0.0.1", () => {
      const { port } = httpServer.address() as AddressInfo
      resolve({
        port,
        close: () =>
          new Promise<void>((res) => {
            wss.close(() => httpServer.close(() => res()))
          }),
      })
    })
  })
}

function handleConnection(
  ws: WebSocket,
  reqUrl: string,
  ctx: {
    resolveCwd: (sandboxName: string) => Promise<string>
    homeDir: () => string
    sessions: TerminalSessions
    shell?: string
  }
): void {
  const url = new URL(reqUrl, "http://localhost")
  const target = parseConnectionTarget(url.searchParams)
  const args = url.searchParams.getAll("arg")
  const key = args[0]
  const command = args.slice(1)

  // A connection must name a session key and a target: a sandbox to run in, or
  // an explicit host session. (A host session needs no sandbox — that's the
  // point: its cwd is `$HOME`.)
  if (!key || (!target.hostSession && !target.sandboxName)) {
    ws.close(1008, "missing target or session")
    return
  }

  const decoder = new TextDecoder()
  let handle: SessionHandle | null = null
  let attaching = false
  let closed = false
  // Frames that arrive after the handshake but before `attach` resolves (it
  // awaits the worktree lookup) — replayed in order once the PTY is live, so the
  // keystrokes a client fires right behind its handshake aren't dropped.
  const pending: TtydClientMessage[] = []

  function apply(msg: TtydClientMessage): void {
    if (!handle) return
    if (msg.type === "input") handle.write(decoder.decode(msg.data))
    else if (msg.type === "resize") handle.resize(msg.columns, msg.rows)
  }

  ws.on("message", (raw) => {
    const msg = decodeClientMessage(toBytes(raw))
    if (handle) {
      apply(msg)
      return
    }
    if (msg.type === "handshake") {
      // The PTY only starts once the client sends its geometry.
      if (attaching) return
      attaching = true
      void attach(msg.columns, msg.rows).then(() => {
        if (!handle) return
        for (const m of pending) apply(m)
        pending.length = 0
      })
      return
    }
    // A command frame racing ahead of the still-attaching PTY: hold it.
    if (attaching) pending.push(msg)
  })

  ws.on("close", () => {
    closed = true
    // Detach only — the PTY keeps running so a webview reload re-attaches to the
    // still-live process (a long-running command survives the reload).
    handle?.detach()
  })

  async function attach(columns: number, rows: number): Promise<void> {
    let cwd: string
    try {
      cwd = await resolveConnectionCwd(target, {
        resolveCwd: ctx.resolveCwd,
        homeDir: ctx.homeDir,
      })
    } catch {
      ws.close(1011, "unknown sandbox")
      return
    }
    if (closed) return
    handle = ctx.sessions.attach({
      key: key!,
      cwd,
      columns,
      rows,
      command,
      shell: ctx.shell,
      listener: {
        onData: (data) => {
          if (ws.readyState === ws.OPEN) ws.send(encodeOutput(data))
        },
        onExit: () => {
          if (ws.readyState === ws.OPEN) ws.close()
        },
      },
    })
  }
}

/**
 * The process-wide local terminal server, started once and cached on
 * `globalThis` so `/api/terminal/url` and `instrumentation.ts` resolve the same
 * port whichever reaches it first (Next can evaluate route and instrumentation
 * modules in separate graphs; the global survives that). The port is
 * configurable via `SCREENPLAY_TERMINAL_WS_PORT`, else ephemeral.
 */
const GLOBAL_KEY = Symbol.for("screenplay.localTerminalServer")
type GlobalHost = typeof globalThis & {
  [GLOBAL_KEY]?: Promise<LocalTerminalServer>
}

export function ensureLocalTerminalServer(): Promise<LocalTerminalServer> {
  const host = globalThis as GlobalHost
  if (!host[GLOBAL_KEY]) {
    const envPort = process.env.SCREENPLAY_TERMINAL_WS_PORT
    host[GLOBAL_KEY] = startLocalTerminalServer({
      port: envPort ? Number(envPort) : undefined,
    })
  }
  return host[GLOBAL_KEY]
}
