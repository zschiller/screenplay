import { NextResponse } from "next/server"
import { getCurrentSession } from "@/lib/auth-helpers"
import { issueTerminalCredential } from "@/lib/sandbox/terminal-credential"

/**
 * Mint a short-lived credential for connecting to a sandbox terminal session.
 * Mirrors `/api/yjs/auth`: an authenticated room member is issued a credential;
 * a non-member is refused.
 *
 * NOTE (ADR 0002): under the default `bearer` posture this credential gates
 * *retrieval* of the terminal URL, not the connection itself — the in-sandbox
 * daemon is reached over a public, unguessable, ephemeral sandbox URL that is
 * the bearer credential, and this signed token is not yet verified on connect.
 * A connect-time verifier (`verifyTerminalCredential`) is wired for the deferred
 * `proxy` strategy but not on this path. Safe under the single-trusted-operator
 * boundary ADR 0002 fixes; `ttyd-credential` moves the shell secret out of the URL.
 */
export async function POST(req: Request) {
  const session = await getCurrentSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let roomId: string | undefined
  let sessionId: string | undefined
  try {
    const body = (await req.json()) as { room?: string; session?: string }
    if (typeof body.room === "string" && body.room.length) roomId = body.room
    if (typeof body.session === "string" && body.session.length) {
      sessionId = body.session
    }
  } catch {
    // Fall through to the missing-field check below.
  }

  if (!roomId || !sessionId) {
    return NextResponse.json(
      { error: "room and session are required" },
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

  return NextResponse.json(credential, { status: 200 })
}
