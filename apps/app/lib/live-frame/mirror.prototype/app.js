// PROTOTYPE (#982). The canvas side of the mirrored route, for two kinds of tab:
//   host.html     the tab the live copy runs in (a real iframe of the dev server)
//   watcher.html  everyone else: an rrweb mirror, whose input is forwarded
// The relay (serve.mjs) stands in for the room: in the product this traffic
// would ride the room's Yjs/WebSocket connection, and `driver` would be the
// #981 record { live, driver, requests[] }.
import { Replayer } from "rrweb"
import { captureInput, shouldApply } from "./forwarding.js"

const params = new URLSearchParams(location.search)
const role = document.body.dataset.role
const name = params.get("name") || (role === "host" ? "Zack" : "Avery")
const $ = (s) => document.querySelector(s)

const ws = new WebSocket(`ws://${location.host}/relay`)
const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m))
let room = { driver: null, peers: [] }
const log = (line) => {
  const el = $("#log")
  el.textContent = `${new Date().toISOString().slice(14, 23)}  ${line}\n` + el.textContent.slice(0, 4000)
}
window.__mirror = { log: [], room: () => room }

function renderRoom() {
  const driving = room.driver === name
  $("#who").textContent = room.driver ? (driving ? "You are driving" : `${room.driver} is driving`) : "Nobody is driving"
  $("#drive").hidden = driving
  $("#blocker").hidden = driving
  document.body.classList.toggle("driving", driving)
  $("#peers").textContent = room.peers.map((p) => `${p.name} (${p.role})`).join(", ")
}
$("#drive").onclick = () => send({ t: "drive", name })

ws.onopen = () => send({ t: "hello", role, name })

if (role === "host") {
  const frame = $("#frame")
  frame.src = `http://127.0.0.1:4101${params.get("path") || "/"}${params.get("canvasFps") ? `?canvasFps=${params.get("canvasFps")}` : ""}`
  const pending = new Map()
  addEventListener("message", (ev) => {
    if (ev.source !== frame.contentWindow) return
    const d = ev.data
    if (d?.type === "screenplay:rr") send({ t: "rr", e: d.e })
    else if (d?.type === "screenplay:input-result") {
      const m = pending.get(d.seq)
      pending.delete(d.seq)
      if (m) send({ t: "result", to: m.from, seq: d.seq, result: d.result })
      window.__mirror.log.push({ ...m, result: d.result })
      log(`${m?.from}: ${m?.kind} → ${d.result}`)
    }
  })
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.t === "room") {
      room = m
      renderRoom()
    } else if (m.t === "input") {
      if (!shouldApply(room, m.input)) {
        log(`${m.input.from}: ${m.input.kind} dropped (not the driver)`)
        return
      }
      pending.set(m.input.seq, m.input)
      frame.contentWindow.postMessage({ type: "screenplay:input", input: m.input }, "*")
    } else if (m.t === "snapshot") {
      frame.contentWindow.postMessage({ type: "screenplay:snapshot" }, "*")
    }
  }
} else {
  const root = $("#mirror")
  let replayer = null
  let seq = 0
  const sentAt = new Map()
  // Text the driver is typing echoes locally. The host's echo of an older
  // value would overwrite what they've typed since and eat characters, so
  // echoes for a field they touched in the last second are skipped.
  const ECHO_QUIET_MS = 1000
  const localEdits = new Map()
  const isStaleEcho = (e) =>
    params.get("echo") !== "all" && e.type === 3 && e.data.source === 5 && performance.now() - (localEdits.get(e.data.id) ?? -Infinity) < ECHO_QUIET_MS
  const idOf = (node) => replayer.getMirror().getId(node)

  // Every full snapshot rebuilds the mirror with document.open(), which
  // drops the document's listeners, so they are attached again each time.
  function attach(doc) {
    const forward = (event) => {
      if (room.driver !== name) return
      const input = captureInput(event, idOf)
      if (!input || input.id == null || input.id < 0) return
      input.from = name
      input.seq = ++seq
      if (input.kind === "value") localEdits.set(input.id, performance.now())
      sentAt.set(input.seq, performance.now())
      send({ t: "input", input })
    }
    // The host is the source of truth: stop the mirror's own default actions
    // (following links, toggling boxes, opening <details>) and let the host's
    // result come back through the mirror. Typing in a text field is the
    // exception: it echoes locally so it doesn't feel laggy.
    doc.addEventListener("click", (e) => {
      if (!(e.target.tagName === "INPUT" && e.target.type !== "checkbox" && e.target.type !== "radio") && e.target.tagName !== "SELECT") e.preventDefault()
      forward(e)
    }, true)
    doc.addEventListener("submit", (e) => e.preventDefault(), true)
    // Escape on the mirror would close the mirror's own copy of a native
    // <dialog> and leave the host's open. The forwarded key closes it there.
    doc.addEventListener("cancel", (e) => e.preventDefault(), true)
    for (const type of ["input", "change", "keydown"]) doc.addEventListener(type, forward, true)
    let lastMove = 0
    doc.addEventListener("pointermove", (e) => {
      const now = performance.now()
      if (now - lastMove < 50) return
      lastMove = now
      forward(e)
    }, true)
    let scrollQueued = null
    doc.addEventListener("scroll", (e) => {
      if (scrollQueued) return
      scrollQueued = e
      requestAnimationFrame(() => {
        forward(scrollQueued)
        scrollQueued = null
      })
    }, true)
  }

  // rrweb closes a modal <dialog> on the mirror by removing its `open`
  // attribute, which leaves it in the top layer with the whole page inert:
  // the mirror stops taking clicks. Close such dialogs properly.
  function releaseClosedDialogs() {
    const doc = replayer?.iframe.contentDocument
    if (!doc) return
    // rrweb also leaves `rrweb-paused` on the mirror in live mode, which
    // pauses every CSS animation. Live means playing.
    doc.documentElement?.classList.remove("rrweb-paused")
    for (const d of doc.querySelectorAll("dialog")) {
      if (d.open || !d.matches(":modal")) continue
      d.setAttribute("open", "") // close() is a no-op on a dialog that isn't open
      d.close()
    }
  }
  // rrweb applies live events on its own timer, so sweep rather than hook.
  setInterval(releaseClosedDialogs, 100)

  function start(events) {
    root.textContent = ""
    replayer = new Replayer([], {
      root,
      liveMode: true,
      mouseTail: false,
      UNSAFE_replayCanvas: params.get("replayCanvas") === "1",
      triggerFocus: true,
      // Live mode never flushes the virtual DOM that sync (backlog) events
      // are applied to, so the late joiner's backlog would never show.
      useVirtualDom: false,
    })
    // rrweb makes its replay inert; the driver's mirror has to take input.
    replayer.iframe.style.pointerEvents = "auto"
    // ...and scrollable, so the driver can scroll the page with the wheel.
    replayer.iframe.removeAttribute("scrolling")
    // Baseline on the host's clock (the newest backlog event), so clock skew
    // between the two machines doesn't delay or rush the live stream.
    replayer.startLive(events.length ? events[events.length - 1].timestamp + 1 : Date.now())
    for (const e of events) replayer.addEvent(e)
    attach(replayer.iframe.contentDocument)
    replayer.on("fullsnapshot-rebuilded", () => attach(replayer.iframe.contentDocument))
    window.__mirror.replayer = replayer
  }

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.t === "room") {
      room = m
      renderRoom()
    } else if (m.t === "backlog") {
      start(m.events)
    } else if (m.t === "rr") {
      if (!replayer) start([m.e])
      else if (!isStaleEcho(m.e)) {
        replayer.addEvent(m.e)
      }
    } else if (m.t === "result") {
      const t0 = sentAt.get(m.seq)
      sentAt.delete(m.seq)
      const ms = t0 ? Math.round(performance.now() - t0) : null
      window.__mirror.log.push({ seq: m.seq, result: m.result, ms })
      if (m.result !== "applied" || ms > 0) log(`#${m.seq} ${m.result}${ms != null ? ` in ${ms}ms (host ack)` : ""}`)
    }
  }
}
