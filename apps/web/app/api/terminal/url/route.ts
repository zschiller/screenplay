import { NextResponse } from "next/server"
import { getCurrentSession } from "@/lib/auth-helpers"
import { resolveLaunchArgv, selectHarnesses } from "@/lib/agent/harnesses"
import { getModelProviders } from "@/lib/agent/providers"
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
      { status: 400 },
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

  const result = await ensureTerminal(sandboxName)
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  // The harnesses actually installed in this sandbox — the same selection fold
  // provisioning runs over `SANDBOX_HARNESSES` + the configured providers. The
  // `harnesses` list (key + label) is the menu a future picker draws from;
  // `launchArgv` is the resolved launch command for *this* tab's stored
  // `harnessKey`, wrapped so Ctrl-D drops to a shell. An empty argv (no/unknown
  // key, or a harness no longer installed) means the tab opens a plain shell.
  const installable = selectHarnesses(
    process.env.SANDBOX_HARNESSES,
    getModelProviders(),
  ).installable
  const harnesses = installable.map((h) => ({ key: h.key, label: h.label }))
  const launchArgv = resolveLaunchArgv(harnessKey, installable)

  return NextResponse.json(
    { url: result.value.url, ...credential, harnesses, launchArgv },
    { status: 200 },
  )
}
