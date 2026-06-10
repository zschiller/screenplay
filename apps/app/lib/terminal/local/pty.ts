import "server-only"

import { chmodSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

import { spawn, type IPty } from "node-pty"

/**
 * The desktop build's terminal transport: a registry of long-lived **node-pty**
 * processes living in the sidecar, keyed by a terminal tab's session id. It
 * replaces the hosted build's ttyd-in-the-sandbox daemon
 * (`lib/sandbox/terminal.ts`) — there is no remote VM, so the PTY is just a host
 * subprocess with the user's shell and env, `cwd` = the Branch's worktree.
 *
 * Two properties this registry exists to provide:
 *
 *  - **Reattach-after-reload.** A webview reload tears down the old WebSocket but
 *    the PTY keeps running in the sidecar; reconnecting with the same session
 *    key re-attaches to the live process (a long-running command is not lost),
 *    and a rolling output buffer is replayed so the pane redraws its current
 *    state. This is what tmux bought the hosted build; here it falls out of the
 *    sidecar simply outliving the socket, so tmux is not needed (ADR 0002).
 *  - **Many viewers, one PTY.** Multiple sockets can attach to one session and
 *    all see the same stream — the local analogue of co-view, though the desktop
 *    app is single-user and this mostly covers the reload handoff.
 *
 * The registry is a process singleton ({@link getTerminalSessions}); the WS
 * bridge (`server.ts`) and the close-tab action (`killTerminalSession`) share
 * it so they agree on which PTY a session key names.
 */

/** Cap on the replayed-on-reattach buffer (chars). Enough to redraw a screen of
 *  scrollback without unbounded growth on a chatty long-running process. */
const BUFFER_LIMIT = 256 * 1024

/** What a single attached socket wants from a session. */
export interface SessionListener {
  /** Called with each PTY output chunk (and once, on attach, with the replay buffer). */
  onData(data: string): void
  /** Called when the PTY exits, so the socket can close. */
  onExit(): void
}

/** Handle a bridge holds for the lifetime of one socket's attachment. */
export interface SessionHandle {
  /** Write raw keystroke bytes to the PTY. */
  write(data: string): void
  /** Resize the real PTY (geometry reaches the process, not just the client). */
  resize(columns: number, rows: number): void
  /** Detach this socket. The PTY keeps running so a reload can re-attach. */
  detach(): void
}

export interface AttachOptions {
  /** Stable per-tab key (the client's `screenplay-<tabId>`); reattach matches on it. */
  key: string
  /** Working directory for a freshly-spawned PTY — the Branch's worktree. */
  cwd: string
  /** Initial geometry from the client handshake. */
  columns: number
  rows: number
  listener: SessionListener
  /** Shell to spawn (defaults to `$SHELL`, then `/bin/bash`, then `/bin/sh`). */
  shell?: string
  /** Extra env merged over the host env for a freshly-spawned PTY. */
  env?: Record<string, string>
  /** Command to run instead of a bare shell (argv); empty → an interactive shell. */
  command?: string[]
}

interface Session {
  pty: IPty
  listeners: Set<SessionListener>
  /** Tail of recent PTY output, replayed to a socket on (re)attach. */
  buffer: string
}

function defaultShell(): string {
  return process.env.SHELL || "/bin/bash"
}

/**
 * node-pty 1.1.0's npm tarball ships the darwin `spawn-helper` prebuild without
 * the executable bit, and nothing in the package restores it. On macOS the
 * shell is exec'd *through* that helper, so every spawn fails with
 * `posix_spawnp failed.` until the mode is repaired. Run once before the first
 * spawn; best-effort — if it can't fix the mode, the spawn fails loudly anyway.
 */
let spawnHelperEnsured = false
function ensureSpawnHelperExecutable(): void {
  if (spawnHelperEnsured || process.platform !== "darwin") return
  spawnHelperEnsured = true
  try {
    const req = createRequire(path.join(process.cwd(), "package.json"))
    const pkgDir = path.dirname(req.resolve("node-pty/package.json"))
    for (const dir of [
      path.join(pkgDir, "prebuilds", `darwin-${process.arch}`),
      path.join(pkgDir, "build", "Release"),
    ]) {
      const helper = path.join(dir, "spawn-helper")
      if (existsSync(helper)) chmodSync(helper, 0o755)
    }
  } catch {
    // Resolution can fail in exotic bundles; the spawn error then surfaces it.
  }
}

/**
 * The app's own model-provider secrets, loaded into the sidecar's env from
 * `.env.local` / the desktop env profile. The user's interactive shell must not
 * inherit them: a `claude` launched in a terminal tab that sees
 * `ANTHROPIC_API_KEY` silently switches from the user's subscription login to
 * API-key billing (likewise codex/opencode with theirs). Mirrors the env-var
 * names the provider registry reads (`lib/agent/providers/`).
 */
const PROVIDER_SECRET_VARS = [
  "AI_GATEWAY_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_COMPATIBLE_API_KEY",
]

/** Append to a session's replay buffer, keeping only the trailing window. */
function appendBuffer(buffer: string, chunk: string): string {
  const next = buffer + chunk
  return next.length > BUFFER_LIMIT ? next.slice(next.length - BUFFER_LIMIT) : next
}

/**
 * Registry of live PTY sessions keyed by session id. Spawns on first attach,
 * reuses on subsequent attaches (reload / co-view), and reaps on PTY exit.
 */
export class TerminalSessions {
  private readonly map = new Map<string, Session>()

  /**
   * Attach a socket to the session named `key`, spawning the PTY if this is the
   * first attach. Returns a handle scoped to this socket; the PTY itself lives
   * past {@link SessionHandle.detach} so a reconnecting client finds it running.
   */
  attach(opts: AttachOptions): SessionHandle {
    let session = this.map.get(opts.key)
    if (!session) {
      session = this.spawn(opts)
      this.map.set(opts.key, session)
    } else {
      // An existing session may have been sized by a previous client; adopt the
      // reconnecting client's geometry so output isn't clipped/wrapped.
      try {
        session.pty.resize(opts.columns, opts.rows)
      } catch {
        // PTY may have exited between map lookup and resize; the exit handler
        // will have removed it. Fall through — the listener gets onExit shortly.
      }
    }

    const { listener } = opts
    session.listeners.add(listener)
    // Replay current screen state so a reconnect redraws rather than showing a
    // blank pane in front of a still-running process.
    if (session.buffer) listener.onData(session.buffer)

    const current = session
    return {
      write: (data) => {
        try {
          current.pty.write(data)
        } catch {
          // Exited; nothing to write to.
        }
      },
      resize: (columns, rows) => {
        try {
          current.pty.resize(columns, rows)
        } catch {
          // Exited; nothing to resize.
        }
      },
      detach: () => {
        current.listeners.delete(listener)
      },
    }
  }

  /** True when a live PTY currently backs `key`. */
  has(key: string): boolean {
    return this.map.has(key)
  }

  /**
   * Kill the PTY for `key` and drop it — the close-tab action's local analogue
   * of the hosted build's `tmux kill-session`. A missing key is a no-op.
   */
  kill(key: string): void {
    const session = this.map.get(key)
    if (!session) return
    this.map.delete(key)
    for (const l of session.listeners) l.onExit()
    session.listeners.clear()
    try {
      session.pty.kill()
    } catch {
      // Already gone.
    }
  }

  private spawn(opts: AttachOptions): Session {
    ensureSpawnHelperExecutable()
    const [file, ...args] =
      opts.command && opts.command.length > 0
        ? opts.command
        : [opts.shell ?? defaultShell()]

    // The host's own env, so the terminal behaves like the user's normal shell
    // in that directory — minus the app's provider secrets (the user's real
    // shell doesn't export those); TERM is pinned to match the xterm.js client.
    const env = { ...process.env } as Record<string, string>
    for (const name of PROVIDER_SECRET_VARS) delete env[name]
    Object.assign(env, opts.env, { TERM: "xterm-256color" })

    const pty = spawn(file!, args, {
      name: "xterm-256color",
      cols: opts.columns,
      rows: opts.rows,
      cwd: opts.cwd,
      env,
    })

    const session: Session = { pty, listeners: new Set(), buffer: "" }

    pty.onData((data) => {
      session.buffer = appendBuffer(session.buffer, data)
      for (const l of session.listeners) l.onData(data)
    })
    pty.onExit(() => {
      this.map.delete(opts.key)
      for (const l of session.listeners) l.onExit()
      session.listeners.clear()
    })

    return session
  }
}

let singleton: TerminalSessions | null = null

/** The process-wide PTY registry shared by the WS bridge and the close action. */
export function getTerminalSessions(): TerminalSessions {
  if (!singleton) singleton = new TerminalSessions()
  return singleton
}
