import "server-only"

import { createHmac } from "crypto"
import { isLocalSandboxBackend } from "@/lib/sandbox/backend"
import { TERMINAL_PORT } from "@/lib/sandbox/provision-internals"
import type { TerminalCredential } from "@/lib/sandbox/terminal-credential"
import type { SandboxInstance } from "@/lib/sandbox/types"

/**
 * What the terminal tab is told to connect to, once the membership gate has
 * passed. `url` is the origin the client opens; `basicAuth` — a ttyd
 * `--credential` (`user:pass`) the client presents on the WebSocket upgrade — is
 * set only by `ttyd-credential` and absent under `bearer` and the local
 * pass-through (so the `bearer` response stays byte-for-byte today's shape). A
 * future `proxy` strategy would add one more field (a connection token) without
 * reshaping this.
 */
export interface TerminalAccessResolution {
  url: string
  basicAuth?: string
}

/**
 * The single seam that owns **what the terminal tab connects to**, resolved from
 * an already-membership-gated request. It sits at the `/api/terminal/url`
 * boundary: the route keeps owning the membership gate (mint the credential
 * first; a `null` is still `403`), and the strategy owns only what happens
 * *after* the gate. This mirrors `selectSandboxProvider()` — one env read at
 * module load, an unknown value throws at startup, not a per-request branch.
 *
 * The shape encodes the decision: given a gated request, resolve exactly what
 * the client connects to and with what. The `basicAuth` field is reserved for
 * the next slice; a future `proxy` would add another field without a reshape.
 */
export interface TerminalAccessStrategy {
  resolve(input: {
    sandbox: SandboxInstance
    credential: TerminalCredential
    binding: { roomId: string; sessionId: string }
  }): Promise<TerminalAccessResolution>

  /**
   * The ttyd `--credential` (`user:pass`) this strategy needs the daemon
   * launched with, or `undefined` to leave the daemon unauthenticated. The
   * daemon-launch path (`launchTerminal`) reads this so the `--credential` the
   * daemon enforces and the `basicAuth` the client is handed both come from the
   * one strategy object and can never drift. Only `ttyd-credential` sets it;
   * `bearer` and the local pass-through leave it undefined.
   */
  daemonCredential?(sandboxName: string): string | undefined
}

/**
 * The fixed, non-secret ttyd `--credential` username under `ttyd-credential`.
 * ttyd base64-encodes the whole `user:pass` and compares it against the
 * `AuthToken` the client presents on the WS handshake, so the username only has
 * to be stable between launch and connect — the secret is the password.
 */
const TTYD_CREDENTIAL_USER = "screenplay"

/**
 * Derive the per-Sandbox ttyd `--credential` (`user:pass`) for the
 * `ttyd-credential` strategy. HMAC over the Sandbox name keys the password to
 * that Branch: stable for the daemon's lifetime, distinct per Branch, and no
 * new stored state — a torn-down Branch (a fresh Sandbox name) invalidates its
 * terminal secret. `TERMINAL_AUTH_SECRET` is the HMAC key (already required for
 * the minted room-member credential), so `ttyd-credential` needs no new secret.
 */
function terminalDaemonCredential(sandboxName: string): string {
  const secret = process.env.TERMINAL_AUTH_SECRET
  if (!secret) throw new Error("TERMINAL_AUTH_SECRET is not set")
  const pass = createHmac("sha256", secret)
    .update(sandboxName)
    .digest("base64url")
  return `${TTYD_CREDENTIAL_USER}:${pass}`
}

/**
 * `bearer` (default) — today's behavior, byte-for-byte. Return the in-Sandbox
 * ttyd daemon's public `domain(port)` URL; the minted credential stays
 * decorative (the daemon runs `--writable` and unauthenticated, so the URL is
 * the whole credential). Zero infrastructure.
 *
 * SAFE ONLY under single-trusted-operator self-hosting. A `domain(port)` URL is
 * a secret bearer link that leaks through Referer headers, browser history,
 * proxy/CDN logs, and screen-shares — channels a real secret shouldn't traverse
 * — so `bearer` is protected only by the subdomain's unguessability plus the
 * Sandbox's ephemerality. Anyone holding the URL gets a writable shell (ADR
 * 0002). This constraint is restated here, at the seam where the choice is made,
 * not only in the ADR.
 */
const bearerStrategy: TerminalAccessStrategy = {
  async resolve({ sandbox }) {
    return { url: sandbox.domain(TERMINAL_PORT) }
  },
}

/**
 * `ttyd-credential` (no new infrastructure) — launch the in-Sandbox ttyd daemon
 * with a per-Sandbox `--credential` and hand the same secret back to the client,
 * which presents it on the WebSocket handshake (`AuthToken`) so ttyd validates
 * it instead of serving unauthenticated. Same public `domain(port)` URL as
 * `bearer`, but the shell secret rides a header the browser never logs — out of
 * the Referer/history/proxy-log/cert-transparency channels that make the raw URL
 * a leaky bearer link — while still hosting nothing beyond Vercel.
 *
 * Residual risk, documented not fixed: the secret is static for the daemon's
 * lifetime and shared across a Sandbox's members, so it is not per-user-revocable
 * mid-session. It closes the URL-channel leak — the whole goal — not a
 * multi-subject-authorization gap; that is the deferred `proxy` strategy's job
 * (ADR 0002). Because it is derived per-Sandbox, a torn-down Branch invalidates
 * its terminal secret.
 */
const ttydCredentialStrategy: TerminalAccessStrategy = {
  async resolve({ sandbox }) {
    return {
      url: sandbox.domain(TERMINAL_PORT),
      basicAuth: terminalDaemonCredential(sandbox.name),
    }
  },
  daemonCredential(sandboxName) {
    return terminalDaemonCredential(sandboxName)
  },
}

/**
 * The desktop **local** backend's pass-through. There is no remote VM or ttyd
 * daemon: the terminal is a node-pty process in the sidecar, reached over a
 * localhost WebSocket (`lib/terminal/local/`). Hand back that server's origin
 * for the target Sandbox and ignore the minted credential — the transport never
 * leaves `127.0.0.1`, so the leaky-URL concern `TERMINAL_AUTH` addresses on the
 * hosted backend doesn't apply. The dynamic import keeps node-pty/`ws` out of
 * the hosted build's module graph.
 */
const localPassthroughStrategy: TerminalAccessStrategy = {
  async resolve({ sandbox }) {
    const { ensureLocalTerminalServer } =
      await import("@/lib/terminal/local/server")
    const { port } = await ensureLocalTerminalServer()
    return {
      url: `http://localhost:${port}/?sandbox=${encodeURIComponent(sandbox.name)}`,
    }
  },
}

/**
 * Select the terminal-access strategy for this deployment. Backend-aware and
 * keyed off the same `SANDBOX_BACKEND` awareness as the rest of `lib/sandbox`:
 * the local backend always resolves to the `127.0.0.1` pass-through regardless
 * of `TERMINAL_AUTH`, so `TERMINAL_AUTH` only meaningfully applies to the hosted
 * backend. There, an unset (or empty) value defaults to `bearer` and an unknown
 * value throws at startup — the same fail-loud fold as `selectSandboxProvider`,
 * so an operator never silently falls back to a weaker posture than they asked
 * for.
 *
 * Read at call time (like `selectSandboxProvider`) so the singleton below is
 * fixed once at module load; there is no per-request branch.
 */
export function selectTerminalAccessStrategy(): TerminalAccessStrategy {
  if (isLocalSandboxBackend()) return localPassthroughStrategy

  const auth = process.env.TERMINAL_AUTH
  if (auth === "bearer" || auth === undefined || auth === "") {
    return bearerStrategy
  }
  if (auth === "ttyd-credential") return ttydCredentialStrategy
  throw new Error(
    `Unknown TERMINAL_AUTH "${auth}" (expected "bearer" or "ttyd-credential")`
  )
}

/**
 * The configured terminal-access strategy singleton, selected once at module
 * load — the terminal counterpart of `sandboxProvider`.
 */
export const terminalAccessStrategy: TerminalAccessStrategy =
  selectTerminalAccessStrategy()
