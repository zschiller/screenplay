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

  // --- Touch-cursor puck (mobile/tablet device preview) ---
  // The parent toggles this with a `screenplay:cursor-mode` message. We hide
  // the system cursor with a !important rule that wins over in-app
  // `cursor: pointer` / `cursor: text` declarations, then track the pointer
  // with a fixed-position div so the puck follows the cursor everywhere
  // inside the iframe — including over interactive elements where a CSS
  // `cursor: url(...)` on the parent <iframe> would otherwise lose.
  let touchCursorEl = null
  let touchCursorStyleEl = null
  let touchPointerMoveHandler = null
  let touchPointerDownHandler = null
  let touchPointerUpHandler = null
  let touchPointerLeaveHandler = null

  function setCursorMode(mode) {
    if (mode === "touch") enableTouchCursor()
    else disableTouchCursor()
  }

  function enableTouchCursor() {
    if (touchCursorEl) return
    if (!document.body) {
      // Bridge runs from <head>, before <body> exists for some HTML shapes.
      // Defer until the document is parsed so the puck has somewhere to live.
      document.addEventListener(
        "DOMContentLoaded",
        () => enableTouchCursor(),
        { once: true },
      )
      return
    }

    const style = document.createElement("style")
    style.id = "__screenplay-touch-cursor-style"
    // Cover pseudo-elements too — some component libraries put the cursor on
    // ::before overlays. !important is required to beat in-app rules.
    style.textContent =
      "html, body, *, *::before, *::after { cursor: none !important }"
    document.head.appendChild(style)
    touchCursorStyleEl = style

    const dot = document.createElement("div")
    dot.id = "__screenplay-touch-cursor"
    Object.assign(dot.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "32px",
      height: "32px",
      marginLeft: "-16px",
      marginTop: "-16px",
      borderRadius: "9999px",
      background: "rgba(15,23,42,0.18)",
      border: "2px solid rgba(255,255,255,0.95)",
      boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
      pointerEvents: "none",
      zIndex: "2147483647",
      transform: "translate3d(-9999px,-9999px,0)",
      transition: "opacity 120ms ease, background 120ms ease, scale 80ms ease",
      opacity: "0",
      willChange: "transform",
    })
    document.body.appendChild(dot)
    touchCursorEl = dot

    touchPointerMoveHandler = (e) => {
      dot.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`
      dot.style.opacity = "1"
    }
    touchPointerDownHandler = () => {
      dot.style.background = "rgba(15,23,42,0.32)"
      dot.style.scale = "0.8"
    }
    touchPointerUpHandler = () => {
      dot.style.background = "rgba(15,23,42,0.18)"
      dot.style.scale = "1"
    }
    touchPointerLeaveHandler = () => {
      dot.style.opacity = "0"
    }
    window.addEventListener("pointermove", touchPointerMoveHandler)
    window.addEventListener("pointerdown", touchPointerDownHandler)
    window.addEventListener("pointerup", touchPointerUpHandler)
    document.addEventListener("pointerleave", touchPointerLeaveHandler)
  }

  function disableTouchCursor() {
    if (touchCursorStyleEl) {
      touchCursorStyleEl.remove()
      touchCursorStyleEl = null
    }
    if (touchCursorEl) {
      touchCursorEl.remove()
      touchCursorEl = null
    }
    if (touchPointerMoveHandler) {
      window.removeEventListener("pointermove", touchPointerMoveHandler)
      touchPointerMoveHandler = null
    }
    if (touchPointerDownHandler) {
      window.removeEventListener("pointerdown", touchPointerDownHandler)
      touchPointerDownHandler = null
    }
    if (touchPointerUpHandler) {
      window.removeEventListener("pointerup", touchPointerUpHandler)
      touchPointerUpHandler = null
    }
    if (touchPointerLeaveHandler) {
      document.removeEventListener("pointerleave", touchPointerLeaveHandler)
      touchPointerLeaveHandler = null
    }
  }

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
        } else if (d.op === "getRectsForSelectors") {
          // Batched op: one round-trip resolves rects for many selectors at
          // once. Used by the canvas to track selector-anchored comment pins.
          const selectors = Array.isArray(d.selectors) ? d.selectors : []
          const rects = selectors.map((sel) => {
            try {
              const el = sel ? document.querySelector(sel) : null
              return el ? rectOf(el) : null
            } catch {
              return null
            }
          })
          reply(d.id, true, rects)
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
      } else if (d.type === "screenplay:scroll-to") {
        // Apply scroll from another client. Prime the echo guard first so the
        // synthetic scroll event this triggers isn't re-broadcast.
        lastScrollX = d.scrollX
        lastScrollY = d.scrollY
        window.scrollTo(d.scrollX, d.scrollY)
      } else if (d.type === "screenplay:cursor-mode") {
        setCursorMode(d.mode)
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

  // Scroll tracking. Trailing-edge throttle at ~20Hz keeps Yjs writes
  // manageable without feeling laggy. The echo guard (lastScrollX/Y) is also
  // updated synchronously in the scroll-to handler so applying a remote
  // scroll doesn't bounce back as a new broadcast.
  let lastScrollX = window.scrollX
  let lastScrollY = window.scrollY
  let scrollTimer = null
  let scrollPending = false
  function emitScroll() {
    const sx = window.scrollX
    const sy = window.scrollY
    if (sx === lastScrollX && sy === lastScrollY) return
    lastScrollX = sx
    lastScrollY = sy
    parent.postMessage({ type: "screenplay:scroll", scrollX: sx, scrollY: sy }, "*")
  }
  function onScroll() {
    if (scrollTimer) { scrollPending = true; return }
    emitScroll()
    scrollTimer = setTimeout(function flush() {
      scrollTimer = null
      if (scrollPending) {
        scrollPending = false
        emitScroll()
        scrollTimer = setTimeout(flush, 50)
      }
    }, 50)
  }
  window.addEventListener("scroll", onScroll, { passive: true })

  parent.postMessage({
    type: "screenplay:ready",
    version: window.__screenplayBridgeVersion || "",
  }, "*")
  parent.postMessage({ type: "screenplay:navigation", path: lastPath }, "*")
  // Deliberately not posting an initial "screenplay:scroll" here. The parent
  // applies any saved scroll in response to ready; re-emitting the iframe's
  // starting (0,0) position would race with that apply and clobber saved
  // state back to zero on late joiners.
})()
