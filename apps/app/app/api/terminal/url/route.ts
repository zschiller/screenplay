import { NextResponse } from "next/server"
import { getCurrentSession } from "@/lib/auth-helpers"
import {
  filterByCapability,
  harnessAvailability,
  resolveTerminalLaunch,
} from "@/lib/agent/harnesses/availability"
import { sandboxProvider } from "@/lib/sandbox"
import { isLocalSandboxBackend } from "@/lib/sandbox/backend"
import { issueTerminalCredential } from "@/lib/sandbox/terminal-credential"
import { terminalAccessStrategy } from "@/lib/sandbox/terminal-access"
import { ensureTerminal } from "@/lib/sandbox/terminal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Resolve the live web-terminal for a room member: gate on membership (reusing
 * `issueTerminalCredential`, which folds in `canAccess` — the same predicate
 * behind `/api/yjs/auth`), then let the configured {@link terminalAccessStrategy}
 * resolve what the client connects to. The gate stays here and runs strictly
 * first — `401` without a session, `403` for a non-member (a `null` credential)
 * — and the strategy owns only what happens after it.
 *
 * The strategy is selected once at module load by `TERMINAL_AUTH`, mirroring how
 * `SANDBOX_BACKEND` selects the Sandbox provider. The default (and only strategy
 * shipped in this slice), `bearer`, reproduces today's behavior byte-for-byte:
 * ensure the ttyd daemon and hand back its public `domain(port)` URL, with the
 * minted credential decorative. That `domain(port)` URL is a secret bearer link
 * (ADR 0002) — SAFE ONLY under single-trusted-operator self-hosting, since it
 * leaks through Referer/history/logs and anyone holding it gets a writable
 * shell. Hardening the transport (moving the secret out of the URL) is the next
 * strategy behind this same seam.
 *
 * `ensureTerminal` is idempotent, so two collaborators opening the same
 * terminal `session` resolve to the same daemon URL and co-view one live PTY.
 */
export async function POST(req: Request) {
  const session = await getCurrentSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let roomId: string | undefined
  let sessionId: string | undefined
  let sandboxName: string | undefined
  let harnessKey: string | undefined
  try {
    const body = (await req.json()) as {
      room?: string
      session?: string
      sandboxName?: string
      harnessKey?: string
    }
    if (typeof body.room === "string" && body.room.length) roomId = body.room
    if (typeof body.session === "string" && body.session.length) {
      sessionId = body.session
    }
    if (typeof body.sandboxName === "string" && body.sandboxName.length) {
      sandboxName = body.sandboxName
    }
    if (typeof body.harnessKey === "string" && body.harnessKey.length) {
      harnessKey = body.harnessKey
    }
  } catch {
    // Fall through to the missing-field check below.
  }

  if (!roomId || !sessionId || !sandboxName) {
    return NextResponse.json(
      { error: "room, session and sandboxName are required" },
      { status: 400 }
    )
  }

  const credential = await issueTerminalCredential({
    roomId,
    sessionId,
    userId: session.user.id,
  })
  if (!credential) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // New tabs are plain shells (#1343): only a tab saved when terminals could
  // launch a harness still has a `harnessKey`, and it keeps launching that CLI
  // until it's closed. The harnesses this deployment can launch come from the
  // backend-aware Harness Availability seam (#476), filtered on the
  // `"terminal"` capability; `launchArgv` is the resolved launch command for
  // *this* tab's stored key, wrapped so Ctrl-D drops to a shell. An empty argv
  // (no/unknown key, or a harness no longer available) means a plain shell.
  const available = filterByCapability(
    await harnessAvailability.list(),
    "terminal"
  )
  const { launchArgv } = resolveTerminalLaunch(harnessKey, available)

  const binding = { roomId, sessionId }

  // Desktop build: the local backend always resolves to the `127.0.0.1`
  // pass-through strategy regardless of `TERMINAL_AUTH`, ignoring the minted
  // credential — there is no remote VM or ttyd daemon, only a node-pty process
  // in the sidecar reached over a localhost WebSocket (`lib/terminal/local/`).
  // The strategy hands back that server's origin for the target sandbox; the
  // unchanged client appends its session key + the resolved launch argv as the
  // wire protocol's `?arg=`s, exactly as it did for ttyd. Resolving the instance
  // here gives the strategy the Sandbox name it keys the localhost origin on; a
  // missing sandbox surfaces as `502` rather than a dead URL.
  if (isLocalSandboxBackend()) {
    let url: string
    try {
      const sandbox = await sandboxProvider.get({ name: sandboxName })
      ;({ url } = await terminalAccessStrategy.resolve({
        sandbox,
        credential,
        binding,
      }))
    } catch {
      return NextResponse.json(
        { error: "Couldn’t reach the terminal." },
        { status: 502 }
      )
    }
    return NextResponse.json(
      { url, ...credential, launchArgv },
      { status: 200 }
    )
  }

  // Hosted: ensure the daemon, then let the strategy resolve what the client
  // connects to. Under `bearer` this is the public `domain(port)` URL and no
  // `basicAuth`, byte-for-byte today's shape; a later strategy adds `basicAuth`
  // the client forwards onto the WS upgrade.
  const result = await ensureTerminal(sandboxName, (sandbox) =>
    terminalAccessStrategy.resolve({ sandbox, credential, binding })
  )
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  // `basicAuth` is spread in only when the strategy sets it (never under
  // `bearer`), so the `bearer` response stays byte-for-byte today's shape.
  const { url, basicAuth } = result.value
  return NextResponse.json(
    {
      url,
      ...(basicAuth ? { basicAuth } : {}),
      ...credential,
      launchArgv,
    },
    { status: 200 }
  )
}
