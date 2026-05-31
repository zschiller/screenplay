import { NextResponse } from "next/server"
import { getCurrentSession } from "@/lib/auth-helpers"
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
  try {
    const body = (await req.json()) as {
      room?: string
      session?: string
      sandboxName?: string
    }
    if (typeof body.room === "string" && body.room.length) roomId = body.room
    if (typeof body.session === "string" && body.session.length) {
      sessionId = body.session
    }
    if (typeof body.sandboxName === "string" && body.sandboxName.length) {
      sandboxName = body.sandboxName
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

  return NextResponse.json(
    { url: result.value.url, ...credential },
    { status: 200 },
  )
}
