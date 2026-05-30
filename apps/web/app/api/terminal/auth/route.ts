import { NextResponse } from "next/server"
import { getCurrentSession } from "@/lib/auth-helpers"
import { issueTerminalCredential } from "@/lib/sandbox/terminal-credential"

/**
 * Mint a short-lived credential for connecting to a sandbox terminal session.
 * Mirrors `/api/yjs/auth`: an authenticated room member is issued a credential;
 * a non-member is refused. The credential gates the terminal-websocket proxy so
 * the in-sandbox daemon (a root shell carrying the operator's git token) is
 * never reachable on an open URL alone.
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

  return NextResponse.json(credential, { status: 200 })
}
