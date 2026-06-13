import { NextResponse } from "next/server"
import { getCurrentSession } from "@/lib/auth-helpers"
import { parseHarnessKeys, unconfiguredBannerArgv } from "@/lib/agent/harnesses"
import {
  filterByCapability,
  harnessAvailability,
  resolveTerminalLaunch,
} from "@/lib/agent/harnesses/availability"
import { isLocalSandboxBackend } from "@/lib/sandbox/backend"
import { issueTerminalCredential } from "@/lib/sandbox/terminal-credential"
import { ensureTerminal } from "@/lib/sandbox/terminal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Resolve the live in-sandbox web-terminal for a room member: gate on
 * membership (reusing `issueTerminalCredential`, which folds in `canAccess` —
 * the same predicate behind `/api/yjs/auth`), then ensure the ttyd daemon is
 * running and hand back its `domain(port)` URL plus the short-lived credential.
 *
 * `ensureTerminal` is idempotent, so two collaborators opening the same
 * terminal `session` resolve to the same daemon URL and co-view one live PTY.
 *
 * NOTE (ADR 0002): the preferred transport is a server WebSocket proxy that
 * re-validates membership on connect, keeping the unauthenticated daemon off
 * the public internet. That needs a WS-capable server; under the App Router's
 * standard `next start` there is no upgrade hook, so this slice uses the ADR's
 * sanctioned fallback — membership-gated URL retrieval feeding an embedded
 * `domain(port)` iframe. Hardening the daemon itself (proxy or a ttyd
 * credential) is tracked as follow-up; safe only under the self-hosted,
 * single-trusted-operator boundary the ADR fixes.
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

  // The harnesses this deployment can launch, read through the backend-aware
  // Harness Availability seam (#476) — the same fold the new-tab picker draws
  // from (`/api/terminal/harnesses`), so the menu and the tab agree on both
  // backends. The terminal surface needs only presence, so it filters on the
  // `"terminal"` capability (every available harness, none dropped for lacking an
  // ACP adapter). `harnesses` (key + label) is the menu payload returned
  // alongside the URL; `launchArgv` is the resolved launch command for *this*
  // tab's stored `harnessKey`, wrapped so Ctrl-D drops to a shell. An empty argv
  // (no/unknown key, or a harness no longer available) means a plain shell.
  const available = filterByCapability(
    await harnessAvailability.list(),
    "terminal"
  )
  const { harnesses, launchArgv } = resolveTerminalLaunch(harnessKey, available)

  // Desktop build: there is no remote VM or ttyd daemon — the terminal is a
  // node-pty process in the sidecar, reached over a localhost WebSocket
  // (`lib/terminal/local/`). Hand back that server's `ws` origin with the target
  // sandbox; the unchanged client appends its session key + the resolved launch
  // argv as the wire protocol's `?arg=`s, exactly as it did for ttyd. The
  // node-pty transport already strips provider API keys from the interactive
  // shell, so the chosen CLI runs on the user's own login, not an API key. No
  // `domain(port)` bearer link, no fetched tmux. The dynamic import keeps
  // node-pty/`ws` out of the hosted build's graph.
  if (isLocalSandboxBackend()) {
    const { ensureLocalTerminalServer } =
      await import("@/lib/terminal/local/server")
    const { port } = await ensureLocalTerminalServer()
    const url = `http://localhost:${port}/?sandbox=${encodeURIComponent(sandboxName)}`
    // Nothing detected on the host → a tab that would open a bare shell instead
    // shows a banner pointing at installing a CLI (the deferred homescreen
    // Settings surface), so an empty desktop explains itself rather than
    // presenting a silent blank shell. A tab whose harness launches never shows
    // it.
    const desktopArgv =
      launchArgv.length === 0 && available.length === 0
        ? unconfiguredBannerArgv("desktop")
        : launchArgv
    return NextResponse.json(
      { url, ...credential, harnesses, launchArgv: desktopArgv },
      { status: 200 }
    )
  }

  const result = await ensureTerminal(sandboxName)
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  // When nothing is configured at all (SANDBOX_HARNESSES unset/empty), a tab that
  // would open a bare shell instead shows a banner telling the operator to set
  // SANDBOX_HARNESSES — so an empty config explains itself rather than presenting
  // a silent blank shell. Gated on the *config* being empty (not the availability
  // list) so a configured-but-unbrokerable harness still falls through to a plain
  // shell exactly as before. A tab whose harness launches never shows it.
  const hostedArgv =
    launchArgv.length === 0 &&
    parseHarnessKeys(process.env.SANDBOX_HARNESSES).length === 0
      ? unconfiguredBannerArgv("hosted")
      : launchArgv

  return NextResponse.json(
    { url: result.value.url, ...credential, harnesses, launchArgv: hostedArgv },
    { status: 200 }
  )
}
