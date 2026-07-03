import { NextResponse } from "next/server"

import { isLocalSandboxBackend } from "@/lib/sandbox/backend"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Resolve the desktop build's **host-session** terminal endpoint (ADR 0014).
 *
 * Unlike `/api/terminal/url`, there is no room, sandbox, or membership
 * credential: a host session runs in the user's `$HOME` to drive the host `gh`
 * CLI (`gh auth login`), so the resolver reads exactly the login it creates.
 * That gate bypass is safe only under the local build's `127.0.0.1`
 * desktop-local trust boundary — the same one the local terminal transport
 * already relies on — so the hosted build, which has no such surface and no
 * local WS server, simply 404s.
 *
 * The response is the local server's `ws` origin tagged with `?host=1`; the
 * unchanged client appends its session key + launch argv as the wire protocol's
 * `?arg=`s, exactly as the sandbox path does.
 */
export async function GET() {
  if (!isLocalSandboxBackend()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const { ensureLocalTerminalServer } =
    await import("@/lib/terminal/local/server")
  const { port } = await ensureLocalTerminalServer()
  return NextResponse.json(
    { url: `http://localhost:${port}/?host=1` },
    { status: 200 }
  )
}
