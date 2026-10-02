;(() => {
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
      disconnectTimer = setTimeout(
        () => postHmrStatus("disconnected"),
        RECONNECTING_GRACE_MS
      )
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
          (c) => c.nodeName === cur.nodeName
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

  // The element's lowercase tag name and its `id` attribute (when present). The
  // composer derives an element token's label from these — the real tag/id —
  // rather than regexing the CSS selector.
  function tagInfo(el) {
    if (!(el instanceof Element)) return { tagName: undefined, id: undefined }
    return {
      tagName: el.nodeName.toLowerCase(),
      id: el.id ? el.id : undefined,
    }
  }

  // --- Comment anchors (#785) ---
  // A comment remembers its element by several keys, tried most durable first:
  // id, test id, text fingerprint, then CSS path. Mirrors `ElementAnchor` in
  // lib/comment-anchor.ts.
  const TEST_ID_ATTRS = ["data-testid", "data-test-id", "data-test", "data-cy"]
  const TEXT_FINGERPRINT_MAX = 80

  function textKey(el) {
    return (el.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, TEXT_FINGERPRINT_MAX)
  }

  function testIdOf(el) {
    for (const attr of TEST_ID_ATTRS) {
      const v = el.getAttribute(attr)
      if (v) return { attr, value: v }
    }
    return null
  }

  function anchorOf(el) {
    const testId = testIdOf(el)
    const text = textKey(el)
    return {
      path: cssPath(el),
      tag: el.nodeName.toLowerCase(),
      id: el.id || undefined,
      testId: testId ? testId.value : undefined,
      text: text || undefined,
    }
  }

  function safeQuery(selector) {
    try {
      return selector ? document.querySelector(selector) : null
    } catch {
      return null
    }
  }

  function resolveAnchor(a) {
    if (!a || typeof a !== "object") return null
    const tag = typeof a.tag === "string" ? a.tag : null
    const sameTag = (el) =>
      !!el && (!tag || el.nodeName.toLowerCase() === tag) ? el : null
    if (a.id) {
      const el = sameTag(document.getElementById(a.id))
      if (el) return el
    }
    if (a.testId) {
      for (const attr of TEST_ID_ATTRS) {
        const el = sameTag(
          safeQuery("[" + attr + '="' + CSS.escape(a.testId) + '"]')
        )
        if (el) return el
      }
    }
    if (a.text && tag) {
      const matches = []
      const all = document.getElementsByTagName(tag)
      for (let i = 0; i < all.length; i++) {
        if (textKey(all[i]) === a.text) matches.push(all[i])
      }
      if (matches.length === 1) return matches[0]
      if (matches.length > 1) {
        // Several elements share the text (list rows): the path breaks the tie.
        const byPath = safeQuery(a.path)
        return byPath && matches.includes(byPath) ? byPath : matches[0]
      }
    }
    return sameTag(safeQuery(a.path))
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
      document.addEventListener("DOMContentLoaded", () => enableTouchCursor(), {
        once: true,
      })
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

    // Two-element split: outer follows the pointer via translate3d; inner
    // owns the visual + press-scale. Combining `transform: translate3d(...)`
    // with the individual `scale` property on a single element scales the
    // translation too (per the CSS Transforms 2 composition order), which
    // would yank the puck toward the viewport origin every press.
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
      pointerEvents: "none",
      zIndex: "2147483647",
      transform: "translate3d(-9999px,-9999px,0)",
      willChange: "transform",
    })
    const inner = document.createElement("div")
    Object.assign(inner.style, {
      width: "100%",
      height: "100%",
      borderRadius: "9999px",
      background: "rgba(15,23,42,0.18)",
      border: "2px solid rgba(255,255,255,0.95)",
      boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
      transition:
        "opacity 120ms ease, background 120ms ease, transform 80ms ease",
      opacity: "0",
      transform: "scale(1)",
      willChange: "transform",
    })
    dot.appendChild(inner)
    document.body.appendChild(dot)
    touchCursorEl = dot

    touchPointerMoveHandler = (e) => {
      dot.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`
      inner.style.opacity = "1"
    }
    touchPointerDownHandler = () => {
      inner.style.background = "rgba(15,23,42,0.32)"
      inner.style.transform = "scale(0.8)"
    }
    touchPointerUpHandler = () => {
      inner.style.background = "rgba(15,23,42,0.18)"
      inner.style.transform = "scale(1)"
    }
    touchPointerLeaveHandler = () => {
      inner.style.opacity = "0"
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
    pickOverlay.id = "__screenplay-pick-overlay"
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
    if (pickOverlay) {
      pickOverlay.remove()
      pickOverlay = null
    }
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
      const tags = tagInfo(el)
      parent.postMessage(
        {
          type: "screenplay:picked",
          handle,
          selector: cssPath(el),
          rect: rectOf(el),
          outerHTML: el.outerHTML,
          tagName: tags.tagName,
          id: tags.id,
          anchor: anchorOf(el),
          path: currentPath(),
        },
        "*"
      )
      // Leave picker active so the parent can let the user re-target; parent
      // controls when to stop via screenplay:pick-stop.
    }
    pickOverlay.addEventListener("mousemove", pickMoveHandler)
    pickOverlay.addEventListener("mouseleave", pickLeaveHandler)
    pickOverlay.addEventListener("click", pickClickHandler, true)
  }

  function stopPick() {
    if (pickOverlay) {
      if (pickMoveHandler)
        pickOverlay.removeEventListener("mousemove", pickMoveHandler)
      if (pickLeaveHandler)
        pickOverlay.removeEventListener("mouseleave", pickLeaveHandler)
      if (pickClickHandler)
        pickOverlay.removeEventListener("click", pickClickHandler, true)
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
    if (!d || typeof d.type !== "string" || !d.type.startsWith("screenplay:"))
      return
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
        } else if (d.op === "getPageSnapshot") {
          // The page as it is right now, for an agent's `read_frame_html`
          // (#1268): its markup and the CSS that styles it, which the server
          // assembles into one self-contained document.
          reply(d.id, true, pageSnapshot(d.selector))
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
        } else if (d.op === "resolveAnchors") {
          // Batched comment-anchor lookup (#785): rects for each anchor, plus
          // the path this frame is on, so the parent can place pins for this
          // viewer only.
          const anchors = Array.isArray(d.anchors) ? d.anchors : []
          const rects = anchors.map((a) => {
            try {
              const el = resolveAnchor(a)
              return el ? rectOf(el) : null
            } catch {
              return null
            }
          })
          reply(d.id, true, { path: currentPath(), rects })
        } else if (d.op === "getDocumentSize") {
          // Measure the true content extent (used by Fit-to-content). Plain
          // scrollWidth/scrollHeight is `max(viewport, content)`, so when the
          // artboard is already larger than its content it just echoes the
          // current size and Fit becomes a no-op. Walking elements and taking
          // the union of their viewport-relative rects (plus current scroll)
          // gives the actual content bounds, regardless of viewport size.
          const body = document.body
          let width = 0
          let height = 0
          if (body) {
            const sx = window.scrollX || 0
            const sy = window.scrollY || 0
            const all = body.getElementsByTagName("*")
            for (let i = 0; i < all.length; i++) {
              const el = all[i]
              const cs = window.getComputedStyle(el)
              // Fixed elements stick to the viewport rather than contributing
              // to scrollable content; including them would inflate the size
              // by scrollY whenever the page is scrolled.
              if (cs.position === "fixed" || cs.display === "none") continue
              const r = el.getBoundingClientRect()
              if (r.width === 0 && r.height === 0) continue
              const right = r.right + sx
              const bottom = r.bottom + sy
              if (right > width) width = right
              if (bottom > height) height = bottom
            }
            // Fallback for empty/odd documents.
            if (width <= 0) width = body.scrollWidth || 0
            if (height <= 0) height = body.scrollHeight || 0
          }
          reply(d.id, true, { width: width, height: height })
        } else if (d.op === "elementAtPoint") {
          const x = typeof d.x === "number" ? d.x : 0
          const y = typeof d.y === "number" ? d.y : 0
          const el = document.elementFromPoint(x, y)
          if (!el || !(el instanceof Element)) {
            reply(d.id, true, null)
          } else {
            const tags = tagInfo(el)
            reply(d.id, true, {
              handle: mint(el),
              selector: cssPath(el),
              rect: rectOf(el),
              outerHTML: el.outerHTML,
              tagName: tags.tagName,
              id: tags.id,
              anchor: anchorOf(el),
              path: currentPath(),
            })
          }
        } else {
          reply(d.id, false, "unknown op: " + d.op)
        }
      } else if (d.type === "screenplay:drive") {
        // PROTOTYPE (#1367): an agent driving this frame with synthetic input.
        drive(d).then(
          (value) => reply(d.id, true, value),
          (err) => reply(d.id, false, (err && err.message) || err)
        )
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
      } else if (d.type === "screenplay:navigate") {
        followRoute(d.path).then(
          (followed) => reply(d.id, true, followed),
          (err) => reply(d.id, false, (err && err.message) || err)
        )
      } else if (d.type === "screenplay:cursor-mode") {
        setCursorMode(d.mode)
      }
    } catch (err) {
      reply(d.id, false, (err && err.message) || err)
    }
  })

  // --- PROTOTYPE (#1367): agent drive ops -----------------------------------
  // Everything here dispatches *synthetic* events (`isTrusted: false`), so it
  // moves whatever the page's own JS listens for, and nothing the browser does
  // by default for a real gesture (see mac-drive.prototype/results.md).

  let driveCursorEl = null
  function showDriveCursor(x, y) {
    if (!document.body) return
    if (!driveCursorEl) {
      driveCursorEl = document.createElement("div")
      driveCursorEl.id = "__screenplay-drive-cursor"
      Object.assign(driveCursorEl.style, {
        position: "fixed",
        top: "0",
        left: "0",
        width: "18px",
        height: "18px",
        margin: "-9px 0 0 -9px",
        borderRadius: "9999px",
        background: "rgba(217,119,87,0.55)",
        border: "2px solid #fff",
        boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
        pointerEvents: "none",
        zIndex: "2147483647",
        transition: "transform 120ms ease-out",
      })
      document.body.appendChild(driveCursorEl)
    }
    driveCursorEl.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== "hidden" && cs.display !== "none"
  }

  function driveLabel(el) {
    return (
      el.getAttribute("aria-label") ||
      (el.labels && el.labels[0] && textKey(el.labels[0])) ||
      el.getAttribute("placeholder") ||
      textKey(el) ||
      el.getAttribute("title") ||
      el.getAttribute("name") ||
      ""
    ).slice(0, 80)
  }

  const INTERACTIVE_SELECTOR =
    'a[href], button, input, select, textarea, summary, [role="button"], ' +
    '[role="link"], [role="tab"], [role="menuitem"], [role="option"], ' +
    '[role="checkbox"], [role="switch"], [role="combobox"], ' +
    '[contenteditable="true"], [tabindex]:not([tabindex="-1"]), [draggable="true"]'

  // The agent's cheap "what can I act on" read: visible interactive elements
  // with a label, a selector to target them by and their rect.
  function listInteractive() {
    const out = []
    const all = document.querySelectorAll(INTERACTIVE_SELECTOR)
    for (let i = 0; i < all.length && out.length < 300; i++) {
      const el = all[i]
      if (el.id && el.id.startsWith("__screenplay")) continue
      if (!isVisible(el)) continue
      const r = el.getBoundingClientRect()
      out.push({
        selector: cssPath(el),
        tag: el.nodeName.toLowerCase(),
        role: el.getAttribute("role") || undefined,
        type: el.getAttribute("type") || undefined,
        label: driveLabel(el),
        value: "value" in el ? String(el.value).slice(0, 80) : undefined,
        disabled: el.disabled || undefined,
        inViewport:
          r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      })
    }
    return {
      path: currentPath(),
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { x: scrollX, y: scrollY },
      elements: out,
    }
  }

  // A target is a selector, visible text (optionally within a tag), or a point.
  function driveTarget(t) {
    if (!t) return document.activeElement || document.body
    if (typeof t.x === "number" && typeof t.y === "number" && !t.selector && !t.text)
      return document.elementFromPoint(t.x, t.y)
    if (t.selector) return document.querySelector(t.selector)
    if (t.text) {
      const want = String(t.text).trim().toLowerCase()
      const pool = document.querySelectorAll(t.tag || INTERACTIVE_SELECTOR)
      let partial = null
      for (let i = 0; i < pool.length; i++) {
        const el = pool[i]
        if (!isVisible(el)) continue
        const label = driveLabel(el).trim().toLowerCase()
        if (label === want) return el
        if (!partial && label.includes(want)) partial = el
      }
      return partial
    }
    return null
  }

  function centerOf(el, t) {
    if (t && typeof t.x === "number" && typeof t.y === "number" && !t.selector && !t.text)
      return { x: t.x, y: t.y }
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }

  function mouseInit(p, extra) {
    return Object.assign(
      {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: p.x,
        clientY: p.y,
        screenX: p.x,
        screenY: p.y,
        button: 0,
        buttons: 1,
        detail: 1,
      },
      extra || {}
    )
  }
  function firePointer(el, type, p, extra) {
    return el.dispatchEvent(
      new PointerEvent(
        type,
        mouseInit(
          p,
          Object.assign(
            { pointerId: 1, pointerType: "mouse", isPrimary: true },
            extra || {}
          )
        )
      )
    )
  }
  function fireMouse(el, type, p, extra) {
    return el.dispatchEvent(new MouseEvent(type, mouseInit(p, extra)))
  }
  function fireHover(el, p) {
    firePointer(el, "pointerover", p, { buttons: 0 })
    firePointer(el, "pointerenter", p, { buttons: 0, bubbles: false })
    fireMouse(el, "mouseover", p, { buttons: 0 })
    fireMouse(el, "mouseenter", p, { buttons: 0, bubbles: false })
    firePointer(el, "pointermove", p, { buttons: 0 })
    fireMouse(el, "mousemove", p, { buttons: 0 })
  }

  function focusableFrom(el) {
    return el.closest(
      'input, textarea, select, button, a[href], [tabindex], [contenteditable="true"]'
    )
  }

  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype
    // React tracks the value through its own setter on the instance; going
    // through the prototype's setter is what makes the `input` event look like
    // a real change to it.
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value)
  }

  function keyInit(key, mods) {
    const named = {
      Enter: 13,
      Escape: 27,
      Tab: 9,
      Backspace: 8,
      " ": 32,
      ArrowLeft: 37,
      ArrowUp: 38,
      ArrowRight: 39,
      ArrowDown: 40,
      Delete: 46,
    }
    const code =
      key.length === 1
        ? /[a-z]/i.test(key)
          ? "Key" + key.toUpperCase()
          : /[0-9]/.test(key)
            ? "Digit" + key
            : key === " "
              ? "Space"
              : ""
        : key
    const keyCode =
      named[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0)
    return Object.assign(
      {
        key,
        code,
        keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
      },
      mods || {}
    )
  }

  function nextPaint() {
    return new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
  }

  function describe(el) {
    if (!el || !(el instanceof Element)) return null
    return {
      selector: cssPath(el),
      tag: el.nodeName.toLowerCase(),
      label: driveLabel(el),
      rect: rectOf(el),
    }
  }

  // Fixed probes for the things an untrusted gesture can't do. Each reports
  // what the browser said rather than throwing.
  async function driveProbe(d) {
    const attempt = async (fn) => {
      try {
        return { ok: true, value: await fn() }
      } catch (err) {
        return { ok: false, error: (err && (err.name + ": " + err.message)) || String(err) }
      }
    }
    const el = d.target ? driveTarget(d.target) : null
    if (d.name === "showPicker")
      return attempt(() => {
        el.showPicker()
        return "opened"
      })
    if (d.name === "clipboardWrite")
      return attempt(() => navigator.clipboard.writeText(String(d.text || "probe")))
    if (d.name === "clipboardRead") return attempt(() => navigator.clipboard.readText())
    if (d.name === "execCopy")
      return attempt(() => {
        if (el && el.select) el.select()
        return document.execCommand("copy")
      })
    if (d.name === "execPaste")
      return attempt(() => {
        if (el) el.focus()
        return document.execCommand("paste")
      })
    if (d.name === "userActivation")
      return attempt(() => ({
        isActive: navigator.userActivation && navigator.userActivation.isActive,
        hasBeenActive: navigator.userActivation && navigator.userActivation.hasBeenActive,
        focused: document.hasFocus(),
      }))
    if (d.name === "matchesHover") return attempt(() => el.matches(":hover"))
    if (d.name === "fullscreen") return attempt(() => el.requestFullscreen())
    throw new Error("unknown probe: " + d.name)
  }

  async function drive(d) {
    const tRecv = Date.now()
    if (d.op === "listInteractive") return listInteractive()
    if (d.op === "probe") return await driveProbe(d)
    if (d.op === "read") {
      // Text and form state of one element, for checking what an op did.
      const r = driveTarget(d.target)
      if (!r) return null
      return {
        text: (r.innerText || r.textContent || "").slice(0, 4000),
        value: "value" in r ? r.value : undefined,
        checked: "checked" in r ? r.checked : undefined,
        files: r.files ? r.files.length : undefined,
      }
    }

    const el = d.op === "scroll" && !d.target ? null : driveTarget(d.target)
    if (d.op !== "scroll" && d.op !== "key" && !el)
      throw new Error("no element for target " + JSON.stringify(d.target))
    if (el && d.op !== "key" && d.op !== "scroll")
      el.scrollIntoView({ block: "nearest", inline: "nearest" })

    let detail
    if (d.op === "click" || d.op === "hover") {
      const p = centerOf(el, d.target)
      // Dispatch on what's really under the point, as a real click would, so
      // an overlay covering the target takes it.
      const hit = document.elementFromPoint(p.x, p.y) || el
      const at = el.contains(hit) || hit.contains(el) ? hit : el
      showDriveCursor(p.x, p.y)
      fireHover(at, p)
      if (d.op === "click") {
        const down = firePointer(at, "pointerdown", p)
        if (down) fireMouse(at, "mousedown", p)
        const f = focusableFrom(at)
        if (f && document.activeElement !== f) f.focus()
        else if (!f && document.activeElement && document.activeElement !== document.body)
          document.activeElement.blur()
        firePointer(at, "pointerup", p, { buttons: 0 })
        fireMouse(at, "mouseup", p, { buttons: 0 })
        // `el.click()` rather than a dispatched MouseEvent would lose the
        // coordinates; a dispatched untrusted `click` still runs activation
        // behaviour (links follow, checkboxes toggle, forms submit).
        fireMouse(at, "click", p, { buttons: 0 })
      }
      detail = { hit: describe(at), obscured: at !== hit }
    } else if (d.op === "type") {
      const f = focusableFrom(el) || el
      f.focus()
      const text = String(d.text == null ? "" : d.text)
      if (f.isContentEditable) {
        if (d.replace) document.execCommand("selectAll")
        document.execCommand("insertText", false, text)
      } else if (d.mode === "execCommand") {
        if (d.replace) f.select && f.select()
        document.execCommand("insertText", false, text)
      } else {
        const next = d.replace ? text : (f.value || "") + text
        f.dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data: text,
          })
        )
        setNativeValue(f, next)
        f.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
        )
        f.dispatchEvent(new Event("change", { bubbles: true }))
      }
      detail = { value: "value" in f ? f.value : f.textContent }
    } else if (d.op === "select") {
      // Native <select>: the popup can't be opened, so set the option directly.
      const opt = Array.from(el.options).find(
        (o) => o.value === d.value || o.textContent.trim() === d.value
      )
      if (!opt) throw new Error("no option " + d.value)
      setNativeValue(el, opt.value)
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
      detail = { value: el.value }
    } else if (d.op === "key") {
      const target = d.target ? el : document.activeElement || document.body
      if (!target) throw new Error("no element for key")
      const init = keyInit(String(d.key), d.modifiers)
      const down = target.dispatchEvent(new KeyboardEvent("keydown", init))
      if (down && String(d.key).length === 1)
        target.dispatchEvent(new KeyboardEvent("keypress", init))
      let emulated
      // The browser's default action never runs for an untrusted key event, so
      // the one that matters most is emulated: Enter submits the form.
      if (down && d.key === "Enter" && target.form && !(target instanceof HTMLTextAreaElement)) {
        target.form.requestSubmit()
        emulated = "form.requestSubmit"
      }
      target.dispatchEvent(new KeyboardEvent("keyup", init))
      detail = { on: describe(target), defaultPrevented: !down, emulated }
    } else if (d.op === "scroll") {
      let scroller = el
      while (scroller && scroller !== document.documentElement) {
        const cs = getComputedStyle(scroller)
        if (
          /(auto|scroll)/.test(cs.overflowY + cs.overflowX) &&
          (scroller.scrollHeight > scroller.clientHeight ||
            scroller.scrollWidth > scroller.clientWidth)
        )
          break
        scroller = scroller.parentElement
      }
      const s = scroller && scroller !== document.documentElement ? scroller : window
      const before = s === window ? [scrollX, scrollY] : [s.scrollLeft, s.scrollTop]
      s.scrollBy({ left: d.dx || 0, top: d.dy || 0, behavior: "instant" })
      const after = s === window ? [scrollX, scrollY] : [s.scrollLeft, s.scrollTop]
      detail = { scroller: s === window ? "window" : cssPath(s), before, after }
    } else if (d.op === "drag") {
      // Pointer-event drag (dnd-kit, sliders, canvases). `to` is a target too.
      const from = centerOf(el, d.target)
      const toEl = driveTarget(d.to)
      if (!toEl) throw new Error("no element for drag destination")
      const to = centerOf(toEl, d.to)
      const steps = d.steps || 8
      showDriveCursor(from.x, from.y)
      fireHover(el, from)
      firePointer(el, "pointerdown", from)
      fireMouse(el, "mousedown", from)
      let html5 = null
      if (d.html5) {
        html5 = new DataTransfer()
        el.dispatchEvent(
          new DragEvent("dragstart", mouseInit(from, { dataTransfer: html5 }))
        )
      }
      for (let i = 1; i <= steps; i++) {
        const p = {
          x: from.x + ((to.x - from.x) * i) / steps,
          y: from.y + ((to.y - from.y) * i) / steps,
        }
        const over = document.elementFromPoint(p.x, p.y) || toEl
        showDriveCursor(p.x, p.y)
        if (html5) {
          over.dispatchEvent(new DragEvent("dragenter", mouseInit(p, { dataTransfer: html5 })))
          over.dispatchEvent(new DragEvent("dragover", mouseInit(p, { dataTransfer: html5 })))
        } else {
          // Pointer capture can't be taken by a synthetic pointer, so move on
          // both the source and the document, wherever the library listens.
          firePointer(over, "pointermove", p)
          fireMouse(over, "mousemove", p)
        }
        await new Promise((r) => requestAnimationFrame(r))
      }
      const dropOn = document.elementFromPoint(to.x, to.y) || toEl
      if (html5) {
        dropOn.dispatchEvent(new DragEvent("drop", mouseInit(to, { dataTransfer: html5 })))
        el.dispatchEvent(new DragEvent("dragend", mouseInit(to, { dataTransfer: html5 })))
      }
      firePointer(dropOn, "pointerup", to, { buttons: 0 })
      fireMouse(dropOn, "mouseup", to, { buttons: 0 })
      detail = { from, to }
    } else {
      throw new Error("unknown drive op: " + d.op)
    }

    const tDone = Date.now()
    await nextPaint()
    return {
      op: d.op,
      target: describe(el),
      detail,
      path: currentPath(),
      active: describe(document.activeElement),
      // Wall-clock stamps (same machine as the agent's caller).
      tRecv,
      tDone,
      tPaint: Date.now(),
    }
  }

  // The page's rendered DOM and its styles, optionally for one element. Scripts
  // are dropped (the result is for reading, not running), and so are the
  // style and link elements whose rules come back in `css`, inlined from the
  // CSSOM so a stylesheet the dev server built in memory is included. Rules
  // that can't style anything in the markup are left out to keep it small; a
  // cross-origin stylesheet can't be read, so it stays a link. Returns null
  // when the selector matches nothing.
  function pageSnapshot(selector) {
    const root = selector
      ? document.querySelector(selector)
      : document.documentElement
    if (!root) return null
    const css = []
    const links = []
    const sheets = Array.from(document.styleSheets).concat(
      Array.from(document.adoptedStyleSheets || [])
    )
    for (const sheet of sheets) {
      if (sheet.disabled) continue
      if (isBridgeUi(sheet.ownerNode)) continue
      let rules
      try {
        rules = sheet.cssRules
      } catch {
        if (sheet.href) links.push(sheet.href)
        continue
      }
      const base = sheet.href || document.baseURI
      const text = keptRules(rules, root)
        .map((r) => absoluteUrls(r, base))
        .join("\n")
      if (text) css.push(text)
    }
    // The whole page is its body; the head holds nothing to show but styles.
    const markup = (selector ? root : document.body || root).cloneNode(true)
    markup
      .querySelectorAll(
        "script, style, link[rel~='stylesheet'], [id^='__screenplay']"
      )
      .forEach((el) => el.remove())
    return {
      url: window.location.href,
      title: document.title,
      htmlAttributes: attributesOf(document.documentElement),
      bodyAttributes: document.body ? attributesOf(document.body) : "",
      markup: selector ? markup.outerHTML : markup.innerHTML,
      css: css.join("\n"),
      stylesheetLinks: links,
    }
  }

  // The rules that can apply under `root`, as CSS text. At-rules without a
  // selector (@font-face, @keyframes, @property, …) are kept whole; grouping
  // rules (@media, @supports, @layer, @container) keep only their live
  // children. A selector with a pseudo-class or pseudo-element is kept, since
  // `:hover` or `::before` can't be tested against the page as it stands.
  function keptRules(rules, root) {
    const out = []
    for (const rule of Array.from(rules)) {
      if (rule.selectorText !== undefined) {
        if (selectorMayApply(rule.selectorText, root)) out.push(rule.cssText)
      } else if (rule.cssRules && !isWholeAtRule(rule)) {
        const inner = keptRules(rule.cssRules, root)
        if (inner.length === 0) continue
        const text = rule.cssText
        out.push(text.slice(0, text.indexOf("{") + 1) + inner.join("\n") + "}")
      } else {
        out.push(rule.cssText)
      }
    }
    return out
  }

  // The bridge's own touch cursor and picker overlay aren't part of the page.
  function isBridgeUi(node) {
    return !!(node && node.id && node.id.startsWith("__screenplay"))
  }

  function isWholeAtRule(rule) {
    return /^@(-[a-z]+-)?(keyframes|font-feature-values)\b/i.test(rule.cssText)
  }

  // `<html>` and `<body>` count for a one-element read too: the document it
  // comes back in keeps their attributes, so their rules (fonts, colours)
  // still apply.
  function selectorMayApply(selectorText, root) {
    if (selectorText.includes(":")) return true
    try {
      return (
        root.matches(selectorText) ||
        !!root.querySelector(selectorText) ||
        document.documentElement.matches(selectorText) ||
        (!!document.body && document.body.matches(selectorText))
      )
    } catch {
      return true
    }
  }

  // Inlined CSS loses its stylesheet's URL, so resolve `url(...)` against it.
  function absoluteUrls(cssText, base) {
    return cssText.replace(
      /url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
      (match, quote, url) => {
        if (/^(data|blob|about):|^#/i.test(url)) return match
        try {
          return 'url("' + new URL(url, base).href + '")'
        } catch {
          return match
        }
      }
    )
  }

  function attributesOf(el) {
    return Array.from(el.attributes)
      .map(
        (a) =>
          a.name +
          '="' +
          a.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;") +
          '"'
      )
      .join(" ")
  }

  function currentPath() {
    return (
      window.location.pathname + window.location.search + window.location.hash
    )
  }

  let lastPath = currentPath()
  // `replace` marks URL changes that edit the current history entry in place
  // (replaceState, and the initial-load report) rather than pushing a new
  // step. Frameworks routinely replaceState right after a real navigation to
  // normalize the path or sync query/scroll state; the parent uses this flag
  // so Create Flow doesn't leave a trail clone for those non-steps.
  function postNavigation(replace) {
    const p = currentPath()
    if (p === lastPath) return
    lastPath = p
    parent.postMessage(
      { type: "screenplay:navigation", path: p, replace: !!replace },
      "*"
    )
  }

  const origPush = history.pushState
  const origReplace = history.replaceState
  history.pushState = function (...args) {
    const r = origPush.apply(this, args)
    postNavigation(false)
    return r
  }
  history.replaceState = function (...args) {
    const r = origReplace.apply(this, args)
    postNavigation(true)
    return r
  }
  window.addEventListener("popstate", () => postNavigation(false))
  window.addEventListener("hashchange", () => postNavigation(false))

  // Follow a route another viewer navigated to without reloading the page, so
  // whatever this viewer typed or opened survives (#999). Resolves true when
  // the page's own router took the route, false when the parent should fall
  // back to reloading the frame onto it.
  //
  // Next exposes its router (App and Pages alike) on `window.next.router`;
  // its popstate handler ignores history entries it didn't write, so it has
  // to be driven through `push`. Anything else (React Router, TanStack, Vue
  // Router, …) listens for popstate, so a pushState plus a synthetic popstate
  // routes it. A page with no client router ignores that, which shows up as
  // an untouched DOM: then it's the reload after all.
  const FOLLOW_SETTLE_MS = 300
  function followRoute(path) {
    if (typeof path !== "string" || path.charAt(0) !== "/")
      return Promise.resolve(false)
    if (path === currentPath()) return Promise.resolve(true)
    const target = new URL(path, location.href)
    if (
      target.hash &&
      target.pathname + target.search === location.pathname + location.search
    ) {
      location.hash = target.hash
      return Promise.resolve(true)
    }
    const next = window.next
    const router = next && next.router
    if (router && typeof router.push === "function") {
      router.push(path)
      return Promise.resolve(true)
    }
    return new Promise((resolve) => {
      const root = document.documentElement
      let settled = false
      const observer = new MutationObserver(() => done(true))
      const timer = setTimeout(() => done(false), FOLLOW_SETTLE_MS)
      function done(changed) {
        if (settled) return
        settled = true
        observer.disconnect()
        clearTimeout(timer)
        resolve(changed)
      }
      observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
      })
      history.pushState(null, "", path)
      dispatchEvent(new PopStateEvent("popstate", { state: null }))
    })
  }

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
    parent.postMessage(
      { type: "screenplay:scroll", scrollX: sx, scrollY: sy },
      "*"
    )
  }
  function onScroll() {
    if (scrollTimer) {
      scrollPending = true
      return
    }
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

  // Zoom gestures over the iframe. A trackpad pinch (and ctrl/cmd + wheel)
  // arrives here as a wheel event with ctrlKey/metaKey set. We must NOT let the
  // browser run its default action — that's the native full-page zoom, which
  // would scale our whole app. The parent can't preventDefault it (this
  // cross-origin iframe captures the event first), so we cancel it here and
  // forward the gesture to the canvas to zoom the canvas instead. Plain
  // scrolling is left untouched so it scrolls the iframe's own content.
  window.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      parent.postMessage(
        {
          type: "screenplay:wheel",
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          clientX: e.clientX,
          clientY: e.clientY,
        },
        "*"
      )
    },
    { passive: false }
  )

  // Esc inside the preview. Keyboard events don't cross the iframe boundary,
  // so without this the canvas never hears Esc once the user clicks into an
  // interactive frame. Listen at the window in the bubble phase so the page
  // handles it first: when the page claims the key (Radix and most dialog
  // libraries preventDefault as they close), the frame stays interactive.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return
    parent.postMessage({ type: "screenplay:escape" }, "*")
  })

  parent.postMessage(
    {
      type: "screenplay:ready",
      version: window.__screenplayBridgeVersion || "",
    },
    "*"
  )
  parent.postMessage(
    { type: "screenplay:navigation", path: lastPath, replace: true },
    "*"
  )
  // Deliberately not posting an initial "screenplay:scroll" here. The parent
  // applies any saved scroll in response to ready; re-emitting the iframe's
  // starting (0,0) position would race with that apply and clobber saved
  // state back to zero on late joiners.
})()
