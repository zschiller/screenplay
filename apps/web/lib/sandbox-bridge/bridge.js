(() => {
  if (window.__screenplayBridge) return
  window.__screenplayBridge = true

  // HMR-status tracking. Patches WebSocket + EventSource so we can observe
  // the dev server's HMR channel (Next webpack/turbopack, Vite, etc.) and
  // notify the parent on connect/close. Pattern is broad because turbopack
  // endpoints have shifted across Next versions — we match any `/_next/`
  // URL as well as explicit hmr/vite markers.
  const HMR_URL_RE = /(_next|hmr|vite|__webpack|turbopack)/i
  const RECONNECTING_GRACE_MS = 5000
  let hmrStatus = "unknown"
  let disconnectTimer = null
  function postHmrStatus(next) {
    if (next === hmrStatus) return
    hmrStatus = next
    parent.postMessage({ type: "screenplay:hmr-status", status: next }, "*")
  }
  function attachOpenClose(conn) {
    conn.addEventListener("open", () => {
      if (disconnectTimer) {
        clearTimeout(disconnectTimer)
        disconnectTimer = null
      }
      postHmrStatus("connected")
    })
    const onGone = () => {
      postHmrStatus("reconnecting")
      if (disconnectTimer) clearTimeout(disconnectTimer)
      disconnectTimer = setTimeout(() => postHmrStatus("disconnected"), RECONNECTING_GRACE_MS)
    }
    conn.addEventListener("close", onGone)
    conn.addEventListener("error", onGone)
  }
  const NativeWebSocket = window.WebSocket
  if (NativeWebSocket && !window.__screenplayWsPatched) {
    window.__screenplayWsPatched = true
    class PatchedWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        super(url, protocols)
        try {
          if (HMR_URL_RE.test(String(url))) attachOpenClose(this)
        } catch {}
      }
    }
    window.WebSocket = PatchedWebSocket
  }
  const NativeEventSource = window.EventSource
  if (NativeEventSource && !window.__screenplayEsPatched) {
    window.__screenplayEsPatched = true
    class PatchedEventSource extends NativeEventSource {
      constructor(url, init) {
        super(url, init)
        try {
          if (HMR_URL_RE.test(String(url))) attachOpenClose(this)
        } catch {}
      }
    }
    window.EventSource = PatchedEventSource
  }

  const HANDLES_MAX = 1024
  const handleToEl = new Map()
  const elToHandle = new WeakMap()
  let nextHandleId = 1

  function mint(el) {
    const existing = elToHandle.get(el)
    if (existing) return existing
    if (handleToEl.size >= HANDLES_MAX) {
      const firstKey = handleToEl.keys().next().value
      if (firstKey) handleToEl.delete(firstKey)
    }
    const h = "h_" + nextHandleId++
    handleToEl.set(h, el)
    elToHandle.set(el, h)
    return h
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  }

  function cssPath(el) {
    if (!(el instanceof Element)) return ""
    const parts = []
    let cur = el
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      if (cur.id) {
        parts.unshift("#" + CSS.escape(cur.id))
        break
      }
      let sel = cur.nodeName.toLowerCase()
      const parent = cur.parentElement
      if (parent) {
        const sameTag = Array.from(parent.children).filter(
          (c) => c.nodeName === cur.nodeName,
        )
        if (sameTag.length > 1) {
          const idx = sameTag.indexOf(cur) + 1
          sel += `:nth-of-type(${idx})`
        }
      }
      parts.unshift(sel)
      cur = cur.parentElement
    }
    return parts.join(" > ")
  }

  function reply(id, ok, payload) {
    const msg = ok
      ? { type: "screenplay:dom-result", id, ok: true, value: payload }
      : { type: "screenplay:dom-result", id, ok: false, error: String(payload) }
    parent.postMessage(msg, "*")
  }

  let pickOverlay = null
  let pickMoveHandler = null
  let pickLeaveHandler = null
  let pickClickHandler = null
  let lastHoverKey = ""

  function ensurePickUi() {
    if (pickOverlay) return
    pickOverlay = document.createElement("div")
    Object.assign(pickOverlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      cursor: "crosshair",
      background: "transparent",
    })
    document.documentElement.appendChild(pickOverlay)
  }

  function removePickUi() {
    if (pickOverlay) { pickOverlay.remove(); pickOverlay = null }
  }

  function elementUnderPointer(x, y) {
    if (!pickOverlay) return null
    pickOverlay.style.pointerEvents = "none"
    const el = document.elementFromPoint(x, y)
    pickOverlay.style.pointerEvents = "auto"
    return el && el !== pickOverlay ? el : null
  }

  function postHover(rect) {
    const key = rect ? `${rect.x}|${rect.y}|${rect.width}|${rect.height}` : ""
    if (key === lastHoverKey) return
    lastHoverKey = key
    parent.postMessage({ type: "screenplay:hover", rect }, "*")
  }

  function startPick() {
    if (pickMoveHandler) return
    ensurePickUi()
    lastHoverKey = ""
    pickMoveHandler = (e) => {
      const el = elementUnderPointer(e.clientX, e.clientY)
      postHover(el ? rectOf(el) : null)
    }
    pickLeaveHandler = () => postHover(null)
    pickClickHandler = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const el = elementUnderPointer(e.clientX, e.clientY)
      if (!el) return
      const handle = mint(el)
      parent.postMessage({
        type: "screenplay:picked",
        handle,
        selector: cssPath(el),
        rect: rectOf(el),
        outerHTML: el.outerHTML,
      }, "*")
      // Leave picker active so the parent can let the user re-target; parent
      // controls when to stop via screenplay:pick-stop.
    }
    pickOverlay.addEventListener("mousemove", pickMoveHandler)
    pickOverlay.addEventListener("mouseleave", pickLeaveHandler)
    pickOverlay.addEventListener("click", pickClickHandler, true)
  }

  function stopPick() {
    if (pickOverlay) {
      if (pickMoveHandler) pickOverlay.removeEventListener("mousemove", pickMoveHandler)
      if (pickLeaveHandler) pickOverlay.removeEventListener("mouseleave", pickLeaveHandler)
      if (pickClickHandler) pickOverlay.removeEventListener("click", pickClickHandler, true)
    }
    pickMoveHandler = null
    pickLeaveHandler = null
    pickClickHandler = null
    lastHoverKey = ""
    postHover(null)
    removePickUi()
  }

  window.addEventListener("message", (e) => {
    const d = e.data
    if (!d || typeof d.type !== "string" || !d.type.startsWith("screenplay:")) return
    if (e.source !== parent) return

    try {
      if (d.type === "screenplay:dom-query") {
        if (d.op === "querySelector") {
          const el = d.selector ? document.querySelector(d.selector) : null
          reply(d.id, true, el ? mint(el) : null)
        } else if (d.op === "getRect") {
          const el = d.handle ? handleToEl.get(d.handle) : null
          reply(d.id, true, el ? rectOf(el) : null)
        } else if (d.op === "getOuterHTML") {
          const el = d.handle ? handleToEl.get(d.handle) : null
          reply(d.id, true, el ? el.outerHTML : null)
        } else if (d.op === "elementAtPoint") {
          const x = typeof d.x === "number" ? d.x : 0
          const y = typeof d.y === "number" ? d.y : 0
          const el = document.elementFromPoint(x, y)
          if (!el || !(el instanceof Element)) {
            reply(d.id, true, null)
          } else {
            reply(d.id, true, {
              handle: mint(el),
              selector: cssPath(el),
              rect: rectOf(el),
              outerHTML: el.outerHTML,
            })
          }
        } else {
          reply(d.id, false, "unknown op: " + d.op)
        }
      } else if (d.type === "screenplay:pick-start") {
        startPick()
        reply(d.id, true, null)
      } else if (d.type === "screenplay:pick-stop") {
        stopPick()
        reply(d.id, true, null)
      } else if (d.type === "screenplay:set-forward-input") {
        // No-op; kept for protocol compatibility with older parent code.
        reply(d.id, true, null)
      }
    } catch (err) {
      reply(d.id, false, (err && err.message) || err)
    }
  })

  function currentPath() {
    return window.location.pathname + window.location.search + window.location.hash
  }

  let lastPath = currentPath()
  function postNavigation() {
    const p = currentPath()
    if (p === lastPath) return
    lastPath = p
    parent.postMessage({ type: "screenplay:navigation", path: p }, "*")
  }

  const origPush = history.pushState
  const origReplace = history.replaceState
  history.pushState = function (...args) {
    const r = origPush.apply(this, args)
    postNavigation()
    return r
  }
  history.replaceState = function (...args) {
    const r = origReplace.apply(this, args)
    postNavigation()
    return r
  }
  window.addEventListener("popstate", postNavigation)
  window.addEventListener("hashchange", postNavigation)

  parent.postMessage({
    type: "screenplay:ready",
    version: window.__screenplayBridgeVersion || "",
  }, "*")
  parent.postMessage({ type: "screenplay:navigation", path: lastPath }, "*")
})()
