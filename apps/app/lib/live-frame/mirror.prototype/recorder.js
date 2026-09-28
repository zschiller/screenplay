// PROTOTYPE (#982). What the Sandbox Bridge would gain on the mirrored route:
// record the live frame with rrweb and post every event to the canvas, and
// replay the driver's forwarded input. Bundled by serve.mjs and injected into
// the demo site's <head>, the way the bridge proxy injects bridge.js today.
import { record } from "rrweb"
import { applyInput } from "./forwarding.js"

const params = new URLSearchParams(location.search)
const canvasFps = Number(params.get("canvasFps") ?? 4)

function post(e) {
  parent.postMessage({ type: "screenplay:rr", e }, "*")
}

record({
  emit: post,
  recordCanvas: canvasFps > 0,
  collectFonts: true,
  inlineStylesheet: true,
  sampling: {
    canvas: canvasFps,
    mousemove: 50,
    scroll: 100,
    input: "last",
    media: 800,
  },
  dataURLOptions: { type: "image/webp", quality: 0.6 },
})

addEventListener("message", (ev) => {
  const d = ev.data
  if (!d || typeof d !== "object") return
  if (d.type === "screenplay:input") {
    const result = applyInput(window, (id) => record.mirror.getNode(id), d.input)
    parent.postMessage({ type: "screenplay:input-result", seq: d.input.seq, result }, "*")
  } else if (d.type === "screenplay:snapshot") {
    record.takeFullSnapshot(true)
  }
})
