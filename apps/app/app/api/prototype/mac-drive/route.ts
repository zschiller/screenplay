// PROTOTYPE (#1367) — throwaway. Stand-in for the agent's tool call: POST an op
// here and it's relayed to the frame in the user's open canvas.
import { NextResponse } from "next/server"

import {
  answerRelay,
  relayToFrame,
  snapshotFrame,
} from "@/lib/live-frame/mac-drive.prototype/server"
import { isAppOrigin } from "@/lib/local-ws-guard"
import { isLocalBuild } from "@/lib/local-mode"

export const runtime = "nodejs"

export async function POST(req: Request) {
  // Off unless the sidecar was launched with a token, and every caller has to
  // prove itself: the agent stand-in with that token, the canvas client (which
  // only ever answers an op by its unguessable id) with the app's own Origin.
  const token = process.env.MAC_DRIVE_PROTOTYPE_TOKEN
  if (!isLocalBuild || !token) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const fromAgent = req.headers.get("x-mac-drive-token") === token
  const fromApp = isAppOrigin(req.headers.get("origin") ?? undefined)
  const tIn = Date.now()
  const body = (await req.json()) as {
    kind: "relay" | "answer" | "snapshot" | "bridge"
    roomId: string
    frameId: string
    message?: Record<string, unknown>
    id?: string
    result?: { ok: boolean; value?: unknown; error?: string }
  }
  try {
    if (body.kind === "answer") {
      if (!fromApp) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      return NextResponse.json({ ok: answerRelay(body.id!, body.result!) })
    }
    if (!fromAgent) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (body.kind === "bridge") {
      // Push the working tree's bridge.js into a running local Sandbox.
      const [{ sandboxProvider }, { writeBridgeFiles }] = await Promise.all([
        import("@/lib/sandbox"),
        import("@/lib/sandbox/provision-internals"),
      ])
      const sandbox = await sandboxProvider.get({
        name: body.frameId,
        resume: false,
      })
      await writeBridgeFiles(sandbox)
      return NextResponse.json({ ok: true })
    }
    if (body.kind === "snapshot") {
      const { png, where, ms } = await snapshotFrame(body.roomId, body.frameId)
      return new Response(new Uint8Array(png), {
        headers: {
          "content-type": "image/png",
          "x-drive-where": JSON.stringify(where),
          "x-drive-ms": JSON.stringify(ms),
        },
      })
    }
    const { value, client, timings } = await relayToFrame(
      body.roomId,
      body.frameId,
      body.message!
    )
    return NextResponse.json({
      ok: true,
      value,
      client,
      timings: { tIn, ...timings, tOut: Date.now() },
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
