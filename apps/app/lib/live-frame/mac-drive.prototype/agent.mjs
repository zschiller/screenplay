#!/usr/bin/env node
// PROTOTYPE (#1367) — throwaway. Stand-in for the agent's tool call.
//
//   MAC_DRIVE_PROTOTYPE_TOKEN=… node agent.mjs <port> <roomId> <frameId> '<json op>'
//   … list                       the frame's interactive elements
//   … snapshot out.png           native snapshot of the frame as shown
//   … bridge <sandboxName>       push the working tree's bridge.js to a Sandbox
//
// An op is the body of a `screenplay:drive` message, e.g.
//   {"op":"click","target":{"text":"Sign in"}}
//   {"op":"type","target":{"selector":"#email"},"text":"a@b.co"}
//   {"op":"key","key":"Enter"}   {"op":"scroll","dy":400}
// or {"query":"elementAtPoint","x":10,"y":10} for an existing dom-query read.
import { writeFileSync } from "node:fs"

const [port, roomId, frameId, what, extra] = process.argv.slice(2)
const token = process.env.MAC_DRIVE_PROTOTYPE_TOKEN

export async function call(body) {
  const t0 = Date.now()
  const res = await fetch(`http://127.0.0.1:${port}/api/prototype/mac-drive`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mac-drive-token": token },
    body: JSON.stringify({ roomId, frameId, ...body }),
  })
  const t1 = Date.now()
  if (res.headers.get("content-type")?.startsWith("image/")) {
    return {
      png: Buffer.from(await res.arrayBuffer()),
      where: JSON.parse(res.headers.get("x-drive-where")),
      ms: { ...JSON.parse(res.headers.get("x-drive-ms")), total: Date.now() - t0 },
    }
  }
  const json = await res.json()
  const v = json.value
  // All stamps are wall-clock on one machine, so they subtract directly.
  if (json.ok && json.timings) {
    json.ms = {
      total: t1 - t0,
      // agent call → server publishes on awareness
      toServer: json.timings.tPublish - t0,
      // awareness → the canvas client picks it up
      toClient: json.client.tClient - json.timings.tPublish,
      // client → bridge received (postMessage), when the bridge stamps it
      toBridge: v?.tRecv ? v.tRecv - json.client.tClient : undefined,
      dispatch: v?.tRecv ? v.tDone - v.tRecv : undefined,
      // agent call → the frame painted the result (two rAFs after dispatch)
      callToPaint: v?.tPaint ? v.tPaint - t0 : undefined,
      back: v?.tPaint ? t1 - v.tPaint : undefined,
    }
  }
  return json
}

export const drive = (op) => call({ kind: "relay", message: { type: "screenplay:drive", ...op } })
export const query = (op, rest = {}) =>
  call({ kind: "relay", message: { type: "screenplay:dom-query", op, ...rest } })

if (import.meta.url === `file://${process.argv[1]}`) {
  if (what === "list") {
    const r = await drive({ op: "listInteractive" })
    if (!r.ok) throw new Error(r.error)
    console.log(`${r.value.path}  "${r.value.title}"  (${r.ms.total} ms)`)
    for (const e of r.value.elements)
      console.log(
        `${e.inViewport ? " " : "↓"} ${e.tag}${e.type ? `[${e.type}]` : ""}${e.role ? `{${e.role}}` : ""}  ${JSON.stringify(e.label)}${e.value ? ` =${JSON.stringify(e.value)}` : ""}  ${e.selector}`
      )
  } else if (what === "snapshot") {
    const r = await call({ kind: "snapshot" })
    if (!r.png) throw new Error(JSON.stringify(r))
    writeFileSync(extra, r.png)
    console.log(JSON.stringify({ bytes: r.png.length, where: r.where, ms: r.ms }))
  } else if (what === "bridge") {
    console.log(JSON.stringify(await call({ kind: "bridge", frameId: extra })))
  } else {
    const op = JSON.parse(what)
    const r = op.query ? await query(op.query, op) : await drive(op)
    console.log(JSON.stringify(r, null, 1))
  }
}
