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
          reply(d.id, true, pageSnapshot(d.selector, d.live === true))
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
          reply(d.id, true, contentSize())
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
        // The agent driving this frame (Frame Drive, #1389).
        drive(d.op).then(
          (result) => reply(d.id, true, result),
          (err) => reply(d.id, false, (err && err.message) || err)
        )
      } else if (d.type === "screenplay:drive-stop") {
        // Someone took control from the agent: end a gesture still running,
        // and take the agent's pointer off the page.
        driveStopped = true
        clearHover()
        reply(d.id, true, null)
      } else if (d.type === "screenplay:drive-locate") {
        // Where a gesture's target is, for a shared frame's real input (#1396).
        driveLocate(d).then(
          (value) => reply(d.id, true, value),
          (err) => reply(d.id, false, (err && err.message) || err)
        )
      } else if (d.type === "screenplay:drive-cursor") {
        // The agent's cursor over a shared frame's real input, at show pace
        // (#1390, #1396): the same cursor the bridge draws for its own.
        driveCursor(d).then(
          () => reply(d.id, true, null),
          (err) => reply(d.id, false, (err && err.message) || err)
        )
      } else if (d.type === "screenplay:drive-state") {
        // What a shared frame's gesture left behind, once it painted.
        driveState(d).then(
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
      } else if (d.type === "screenplay:watch-content-size") {
        watchContentSize(d.on === true)
      }
    } catch (err) {
      reply(d.id, false, (err && err.message) || err)
    }
  })

  // --- Frame Drive (#1389) -------------------------------------------------
  // The agent's gestures and reads (`lib/frame-drive/contract.ts`). A fixed
  // set of ops, never a script. They dispatch synthetic events, so they move
  // whatever the page's own code listens for, and nothing the browser does
  // itself for a real gesture: a gesture that needs that answers with the gap
  // instead (focus, file pickers, native popups, the clipboard). Hover styles
  // are the exception, forced (see Hover).

  let driveStopped = false

  const DRIVE_INTERACTIVE =
    'a[href], button, input, select, textarea, summary, label, [role="button"], ' +
    '[role="link"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], ' +
    '[role="menuitemradio"], [role="option"], [role="checkbox"], [role="radio"], ' +
    '[role="switch"], [role="combobox"], [role="slider"], [role="treeitem"], ' +
    '[contenteditable="true"], [contenteditable=""], [tabindex]:not([tabindex="-1"]), ' +
    '[draggable="true"]'
  const DRIVE_ELEMENTS_MAX = 300
  const NATIVE_PICKER_TYPES = [
    "date",
    "time",
    "datetime-local",
    "month",
    "week",
    "color",
  ]

  function driveVisible(el) {
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

  function driveDescribe(el) {
    if (!el || !(el instanceof Element)) return null
    return {
      selector: cssPath(el),
      tag: el.nodeName.toLowerCase(),
      label: driveLabel(el),
    }
  }

  function driveElements(selector) {
    const elements = []
    const all = document.querySelectorAll(DRIVE_INTERACTIVE)
    for (let i = 0; i < all.length; i++) {
      if (elements.length >= DRIVE_ELEMENTS_MAX) break
      const el = all[i]
      if (isBridgeUi(el) || !driveVisible(el)) continue
      // A label wrapping a control it names is the control's, not a target.
      if (el.nodeName === "LABEL" && el.control && el.contains(el.control))
        continue
      const r = el.getBoundingClientRect()
      const entry = {
        selector: cssPath(el),
        tag: el.nodeName.toLowerCase(),
        label: driveLabel(el),
        inViewport:
          r.bottom > 0 &&
          r.top < innerHeight &&
          r.right > 0 &&
          r.left < innerWidth,
      }
      const role = el.getAttribute("role")
      if (role) entry.role = role
      const type = el.getAttribute("type")
      if (type) entry.type = type
      if ("value" in el && el.nodeName !== "BUTTON" && el.nodeName !== "LI")
        entry.value = String(el.value).slice(0, 80)
      if (el.type === "checkbox" || el.type === "radio")
        entry.checked = !!el.checked
      else if (el.hasAttribute("aria-checked"))
        entry.checked = el.getAttribute("aria-checked") === "true"
      if (el.disabled || el.getAttribute("aria-disabled") === "true")
        entry.disabled = true
      elements.push(entry)
    }
    const result = {
      path: currentPath(),
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { x: scrollX, y: scrollY },
      elements,
    }
    if (selector) {
      const el = safeQuery(selector)
      result.read = el
        ? {
            text: (el.innerText || el.textContent || "").slice(0, 4000),
            value: "value" in el ? String(el.value) : undefined,
            checked: "checked" in el ? !!el.checked : undefined,
          }
        : null
    }
    return result
  }

  function isPoint(t) {
    return !!t && typeof t.x === "number" && typeof t.y === "number"
  }

  // A target is a selector, an element's visible label, or a point.
  function driveTarget(t) {
    if (!t || typeof t !== "object") return null
    if (t.selector) return safeQuery(t.selector)
    if (t.text) {
      const want = String(t.text).replace(/\s+/g, " ").trim().toLowerCase()
      const pool = document.querySelectorAll(DRIVE_INTERACTIVE)
      let partial = null
      for (let i = 0; i < pool.length; i++) {
        const el = pool[i]
        if (isBridgeUi(el) || !driveVisible(el)) continue
        const label = driveLabel(el).trim().toLowerCase()
        if (label === want) return el
        if (!partial && label.includes(want)) partial = el
      }
      return partial
    }
    if (isPoint(t)) return document.elementFromPoint(t.x, t.y)
    return null
  }

  function centerOf(el, t) {
    if (isPoint(t) && !t.selector && !t.text) return { x: t.x, y: t.y }
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }

  function mouseInit(p, extra) {
    return Object.assign(
      {
        bubbles: true,
        cancelable: true,
        composed: true,
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
    const init = mouseInit(
      p,
      Object.assign(
        { pointerId: 1, pointerType: "mouse", isPrimary: true },
        extra || {}
      )
    )
    const Ctor = window.PointerEvent || MouseEvent
    return el.dispatchEvent(new Ctor(type, init))
  }

  function fireMouse(el, type, p, extra) {
    return el.dispatchEvent(new MouseEvent(type, mouseInit(p, extra)))
  }

  // --- Hover -----------------------------------------------------------------
  // The agent's pointer rests on whatever it last hovered, clicked or dropped
  // on. Its synthetic events reach the page's own handlers (a Radix tooltip
  // or hover card opens on them), but the browser never sets :hover for them.
  // So hover styles are forced: every :hover rule the page can read gets a
  // twin that matches a marker instead, and the hovered element and its
  // ancestors carry the marker, as :hover would. A cross-origin stylesheet
  // can't be read, so its hover styles don't show. A person's own pointer
  // moving in the page hands :hover back to the browser.

  const HOVER_ATTR = "data-screenplay-hover"
  const HOVER_SELECTOR = /:hover(?![\w-])/
  const hoverTwinned = new WeakSet()
  let hovered = null

  function markTwinned(rule) {
    hoverTwinned.add(rule)
    let rules = null
    try {
      rules = rule.cssRules
    } catch {}
    if (rules) for (let i = 0; i < rules.length; i++) markTwinned(rules[i])
  }

  // Give each :hover rule in `owner` (a sheet, or a rule holding rules) a
  // twin right after it, once.
  function twinHoverRules(owner) {
    let rules = null
    try {
      rules = owner.cssRules
    } catch {
      return
    }
    if (!rules) return
    for (let i = rules.length - 1; i >= 0; i--) {
      const rule = rules[i]
      if (hoverTwinned.has(rule)) continue
      hoverTwinned.add(rule)
      if (rule.styleSheet) twinHoverRules(rule.styleSheet)
      twinHoverRules(rule)
      const selector = rule.selectorText
      if (typeof selector !== "string" || !HOVER_SELECTOR.test(selector))
        continue
      try {
        owner.insertRule(rule.cssText, i + 1)
        const twin = owner.cssRules[i + 1]
        twin.selectorText = selector.replace(
          new RegExp(HOVER_SELECTOR.source, "g"),
          "[" + HOVER_ATTR + "]"
        )
        markTwinned(twin)
      } catch {}
    }
  }

  function forceHoverStyles() {
    const sheets = Array.from(document.styleSheets || [])
    if (document.adoptedStyleSheets)
      sheets.push.apply(sheets, document.adoptedStyleSheets)
    sheets.forEach(twinHoverRules)
  }

  // An element and its ancestors, innermost first: what :hover matches.
  function hoverChain(el) {
    const chain = []
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(n)
    return chain
  }

  // Move the agent's pointer onto `el` at `p`, as a real pointer moving there
  // would: out of what it was over, into `el`, then a move.
  function moveHover(el, p) {
    const prev = hovered
    const next = hoverChain(el)
    const off = { buttons: 0 }
    const once = { buttons: 0, bubbles: false }
    if (prev && prev.el !== el) {
      firePointer(prev.el, "pointerout", p, off)
      hoverChain(prev.el)
        .filter((n) => next.indexOf(n) === -1)
        .forEach((n) => firePointer(n, "pointerleave", p, once))
      fireMouse(prev.el, "mouseout", p, off)
      hoverChain(prev.el)
        .filter((n) => next.indexOf(n) === -1)
        .forEach((n) => fireMouse(n, "mouseleave", p, once))
    }
    if (!prev || prev.el !== el) {
      const was = prev ? hoverChain(prev.el) : []
      const entering = next.filter((n) => was.indexOf(n) === -1).reverse()
      firePointer(el, "pointerover", p, off)
      entering.forEach((n) => firePointer(n, "pointerenter", p, once))
      fireMouse(el, "mouseover", p, off)
      entering.forEach((n) => fireMouse(n, "mouseenter", p, once))
    }
    firePointer(el, "pointermove", p, off)
    fireMouse(el, "mousemove", p, off)
    forceHoverStyles()
    if (prev) hoverChain(prev.el).forEach((n) => n.removeAttribute(HOVER_ATTR))
    next.forEach((n) => n.setAttribute(HOVER_ATTR, ""))
    hovered = { el, p }
  }

  // The agent's pointer leaves the page.
  function clearHover() {
    if (!hovered) return
    const { el, p } = hovered
    hovered = null
    const chain = hoverChain(el)
    chain.forEach((n) => n.removeAttribute(HOVER_ATTR))
    if (!el.isConnected) return
    firePointer(el, "pointerout", p, { buttons: 0 })
    chain.forEach((n) =>
      firePointer(n, "pointerleave", p, { buttons: 0, bubbles: false })
    )
    fireMouse(el, "mouseout", p, { buttons: 0 })
    chain.forEach((n) =>
      fireMouse(n, "mouseleave", p, { buttons: 0, bubbles: false })
    )
  }

  // A person's own pointer in the page: :hover is the browser's again.
  window.addEventListener(
    "pointermove",
    (e) => {
      if (e.isTrusted && hovered) clearHover()
    },
    { capture: true, passive: true }
  )

  function textFieldOf(el) {
    if (!el) return null
    const field =
      el.closest("input, textarea, [contenteditable]") ||
      (el.nodeName === "LABEL" && el.control) ||
      el.querySelector("input, textarea, [contenteditable]")
    return field || null
  }

  function isEditable(el) {
    if (!el || !el.getAttribute) return false
    const attr = el.getAttribute("contenteditable")
    return !!el.isContentEditable || (attr !== null && attr !== "false")
  }

  function isTextField(el) {
    if (!el) return false
    if (el.nodeName === "TEXTAREA" || isEditable(el)) return true
    return (
      el.nodeName === "INPUT" &&
      !/^(checkbox|radio|button|submit|reset|file|image|range|hidden)$/i.test(
        el.type
      )
    )
  }

  // React tracks a field's value through its own setter on the instance;
  // going through the prototype's setter makes the `input` event read as a
  // real change.
  function setNativeValue(el, value) {
    const proto =
      el.nodeName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : el.nodeName === "SELECT"
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype
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
      Home: 36,
      End: 35,
      PageUp: 33,
      PageDown: 34,
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
    const m = mods || {}
    return {
      key,
      code,
      keyCode,
      which: keyCode,
      shiftKey: !!m.shiftKey,
      ctrlKey: !!m.ctrlKey,
      altKey: !!m.altKey,
      metaKey: !!m.metaKey,
      bubbles: true,
      cancelable: true,
      composed: true,
    }
  }

  // Two frames after the gesture, so the answer describes what painted. A
  // background window can throttle animation frames, so it never waits long.
  function nextPaint() {
    return new Promise((resolve) => {
      const done = setTimeout(resolve, 120)
      if (typeof requestAnimationFrame !== "function") return
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          clearTimeout(done)
          resolve()
        })
      )
    })
  }

  // Notes whether the page reached for the clipboard while a gesture ran:
  // an untrusted gesture can't use it, so that part silently failed.
  function watchClipboard() {
    let used = false
    const undo = []
    // Shadow a method for the gesture, then put back exactly what was there.
    const wrap = (obj, name, spy) => {
      const orig = obj && obj[name]
      if (typeof orig !== "function") return
      const own = Object.prototype.hasOwnProperty.call(obj, name)
      try {
        obj[name] = function () {
          spy(arguments)
          return orig.apply(obj, arguments)
        }
        undo.push(() => {
          if (own) obj[name] = orig
          else delete obj[name]
        })
      } catch {}
    }
    const clip = navigator.clipboard
    ;["writeText", "readText", "write", "read"].forEach((name) =>
      wrap(clip, name, () => {
        used = true
      })
    )
    wrap(document, "execCommand", (args) => {
      if (/^(copy|cut|paste)$/i.test(String(args[0]))) used = true
    })
    return {
      used: () => used,
      restore: () => undo.forEach((fn) => fn()),
    }
  }

  // --- Show pace (#1390) ---------------------------------------------------
  // "Show me" plays each gesture at a pace a person can follow: a cursor
  // glides to the target and pauses before the gesture lands, typing goes in
  // a character at a time, and scrolls and drags move smoothly. The cursor is
  // drawn in the page, so it's the same picture wherever the frame runs. It
  // takes no pointer events, so nothing hits it, and reads skip it.

  const SHOW_GLIDE_MS = 450
  const SHOW_PAUSE_MS = 350
  const SHOW_SCROLL_MS = 450
  const SHOW_TYPE_MS = 45
  const SHOW_TYPE_MAX_MS = 2000
  const SHOW_DRAG_STEPS = 24
  const SHOW_LINGER_MS = 3000
  const SHOW_INK = "#0a0a0a"
  let showCursor = null
  let showAt = null
  let showHide = null

  function isShow(op) {
    return !!op && op.pace === "show"
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  function placeShowCursor(p) {
    showCursor.style.transform = "translate3d(" + p.x + "px," + p.y + "px,0)"
    showAt = p
  }

  // The agent's cursor: the canvas's cursor arrow in ink, named Agent.
  function ensureShowCursor() {
    if (showCursor && showCursor.isConnected) return showCursor
    const el = document.createElement("div")
    el.id = "__screenplay-drive-cursor"
    el.setAttribute("aria-hidden", "true")
    Object.assign(el.style, {
      position: "fixed",
      top: "0",
      left: "0",
      pointerEvents: "none",
      zIndex: "2147483647",
      opacity: "0",
      transition: "opacity 150ms ease",
      willChange: "transform",
    })
    el.innerHTML =
      '<svg width="16" height="20" viewBox="0 0 16 20" fill="none" ' +
      'style="display:block;overflow:visible;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.3));transition:transform 120ms ease">' +
      '<path d="M0.928711 0.0737305L15.0713 11.3833L8.20055 11.8235L4.56463 19.0005L0.928711 0.0737305Z" ' +
      'fill="' +
      SHOW_INK +
      '" stroke="#fff" stroke-width="1.25" stroke-linejoin="round"/></svg>' +
      '<span style="display:inline-block;margin:4px 0 0 12px;padding:2px 6px;border-radius:4px;' +
      "background:" +
      SHOW_INK +
      ";color:#fff;font:500 12px/16px ui-sans-serif,system-ui,-apple-system,sans-serif;" +
      'white-space:nowrap;letter-spacing:0;box-shadow:0 0 0 1px #fff,0 1px 2px rgba(0,0,0,0.3)">Agent</span>'
    document.documentElement.appendChild(el)
    showCursor = el
    showAt = null
    return el
  }

  // Glide the cursor to `p`, then pause there. True when someone took
  // control meanwhile, so the gesture must not land.
  async function showGlide(p) {
    const el = ensureShowCursor()
    clearTimeout(showHide)
    if (!showAt) {
      // First step: appear where the page's middle is, then glide from there.
      el.style.transition = "opacity 150ms ease"
      placeShowCursor({ x: innerWidth / 2, y: innerHeight / 2 })
      void el.offsetWidth
    }
    el.style.transition =
      "opacity 150ms ease, transform " +
      SHOW_GLIDE_MS +
      "ms cubic-bezier(0.4, 0, 0.2, 1)"
    el.style.opacity = "1"
    placeShowCursor(p)
    await wait(SHOW_GLIDE_MS)
    if (driveStopped) return true
    await wait(SHOW_PAUSE_MS)
    return driveStopped
  }

  // A pause with the cursor where it is, for a step with no target.
  async function showPause() {
    await wait(SHOW_PAUSE_MS)
    return driveStopped
  }

  // The press: the arrow dips as the click lands.
  function showPress() {
    const arrow = showCursor && showCursor.firstChild
    if (!arrow) return
    arrow.style.transform = "scale(0.85)"
    setTimeout(() => {
      arrow.style.transform = ""
    }, 140)
  }

  // Follow the pointer without easing, for a drag.
  function showFollow(p) {
    if (!showCursor) return
    showCursor.style.transition = "opacity 150ms ease"
    placeShowCursor(p)
  }

  // The cursor stays a moment after a step, then fades, so a run of steps
  // reads as one movement and a finished demo leaves the page clean.
  function showLinger() {
    clearTimeout(showHide)
    showHide = setTimeout(hideShowCursor, SHOW_LINGER_MS)
  }

  function hideShowCursor() {
    clearTimeout(showHide)
    if (showCursor) showCursor.remove()
    showCursor = null
    showAt = null
  }

  // A shared frame's service plays show pace with real input, and draws the
  // cursor through here: glide to a point and pause, pause where it is, dip
  // for a press, follow a drag, linger after a step, or go.
  async function driveCursor(d) {
    if (d.to) return void (await showGlide(d.to))
    if (d.pause) return void (await showPause())
    if (d.press) return showPress()
    if (d.follow) return showFollow(d.follow)
    if (d.linger) return showLinger()
    hideShowCursor()
  }

  // Bring the target into view: smoothly, and waited for, at show pace.
  async function inViewAtPace(el, show) {
    if (!el || !el.scrollIntoView) return
    if (!show) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" })
      return
    }
    const r = el.getBoundingClientRect()
    const out =
      r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth
    if (!out) return
    el.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    })
    await wait(SHOW_SCROLL_MS)
  }

  // A page still parsing has only part of its body: Frame Drive reads and
  // acts on the whole document, so it waits for the parse to finish.
  function parsed() {
    if (document.readyState !== "loading") return Promise.resolve()
    return new Promise((resolve) =>
      document.addEventListener("DOMContentLoaded", () => resolve(), {
        once: true,
      })
    )
  }

  async function drive(op) {
    if (!op || typeof op !== "object") throw new Error("missing drive op")
    await parsed()
    if (op.op === "elements") {
      return { status: "read", value: driveElements(op.selector) }
    }
    driveStopped = false
    if (!isShow(op)) hideShowCursor()
    const result = await driveGesture(op)
    if (isShow(op)) showLinger()
    return result
  }

  function driveGesture(op) {
    if (op.op === "click") return driveClick(op)
    if (op.op === "type") return driveType(op)
    if (op.op === "key") return driveKey(op)
    if (op.op === "scroll") return driveScroll(op)
    if (op.op === "select") return driveSelect(op)
    if (op.op === "drag") return driveDrag(op)
    if (op.op === "hover") return driveHover(op)
    throw new Error("unknown drive op: " + op.op)
  }

  async function done(op, el, extra) {
    await nextPaint()
    return {
      status: "done",
      value: Object.assign(
        { op: op.op, target: driveDescribe(el), path: currentPath() },
        extra || {}
      ),
    }
  }

  function gap(name, el) {
    return { status: "gap", gap: name, target: driveDescribe(el) }
  }

  // The target, scrolled into view first as a real gesture would need.
  async function driveTargetInView(t, show) {
    const el = driveTarget(t)
    await inViewAtPace(el, show)
    return el
  }

  async function driveClick(op) {
    const show = isShow(op)
    const el = await driveTargetInView(op.target, show)
    if (!el) return { status: "not-found", target: op.target }
    const control = el.nodeName === "LABEL" && el.control ? el.control : el
    if (control.nodeName === "INPUT" && control.type === "file")
      return gap("file-picker", control)
    if (control.nodeName === "SELECT") return gap("native-select", control)
    if (
      control.nodeName === "INPUT" &&
      NATIVE_PICKER_TYPES.indexOf(control.type) !== -1
    )
      return gap("native-picker", control)

    const p = centerOf(el, op.target)
    if (show) {
      if (await showGlide(p)) return { status: "taken" }
      showPress()
    }
    // What's really under the point takes the click, as a real click would,
    // so an overlay covering the target gets it.
    const hit = document.elementFromPoint(p.x, p.y)
    const at = hit && (el.contains(hit) || hit.contains(el)) ? hit : el
    const clipboard = watchClipboard()
    try {
      moveHover(at, p)
      if (firePointer(at, "pointerdown", p)) fireMouse(at, "mousedown", p)
      firePointer(at, "pointerup", p, { buttons: 0 })
      fireMouse(at, "mouseup", p, { buttons: 0 })
      // An untrusted `click` still runs activation behaviour: links follow,
      // checkboxes toggle, forms submit.
      fireMouse(at, "click", p, { buttons: 0 })
      const result = await done(op, el)
      return clipboard.used() ? gap("clipboard", el) : result
    } finally {
      clipboard.restore()
    }
  }

  async function driveType(op) {
    const show = isShow(op)
    const el = await driveTargetInView(op.target, show)
    if (!el) return { status: "not-found", target: op.target }
    const field = textFieldOf(el)
    if (!field || !isTextField(field))
      throw new Error("the target isn't a text field")
    if (isEditable(field)) return gap("rich-text", field)
    const text = String(op.text == null ? "" : op.text)
    if (show) {
      if (await showGlide(centerOf(field))) return { status: "taken" }
      showPress()
      return typeAtPace(op, field, text)
    }
    const next = op.replace ? text : (field.value || "") + text
    field.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      })
    )
    setNativeValue(field, next)
    field.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      })
    )
    field.dispatchEvent(new Event("change", { bubbles: true }))
    return done(op, field, { value: String(field.value) })
  }

  // Type a character at a time, each its own input, as a person would.
  async function typeAtPace(op, field, text) {
    if (op.replace && field.value) {
      setNativeValue(field, "")
      field.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "deleteContentBackward",
        })
      )
    }
    const base = field.value || ""
    const chars = Array.from(text)
    const per = Math.min(
      SHOW_TYPE_MS,
      SHOW_TYPE_MAX_MS / Math.max(1, chars.length)
    )
    for (let i = 0; i < chars.length; i++) {
      if (driveStopped) return { status: "taken" }
      field.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: chars[i],
        })
      )
      setNativeValue(field, base + chars.slice(0, i + 1).join(""))
      field.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: chars[i],
        })
      )
      await wait(per)
    }
    field.dispatchEvent(new Event("change", { bubbles: true }))
    return done(op, field, { value: String(field.value) })
  }

  async function driveKey(op) {
    const key = String(op.key || "")
    if (!key) throw new Error("missing key")
    const show = isShow(op)
    let el = null
    if (op.target) {
      el = await driveTargetInView(op.target, show)
      if (!el) return { status: "not-found", target: op.target }
    }
    if (key === "Tab") return gap("tab", el)
    if (show && (el ? await showGlide(centerOf(el)) : await showPause()))
      return { status: "taken" }
    const target = el || document.activeElement || document.body
    const init = keyInit(key, op.modifiers)
    const typing =
      key.length === 1 && !init.ctrlKey && !init.metaKey && !init.altKey
    const down = target.dispatchEvent(new KeyboardEvent("keydown", init))
    if (down && typing)
      target.dispatchEvent(new KeyboardEvent("keypress", init))
    let emulated
    // The browser's default action never runs for an untrusted key, so the
    // one that matters most is emulated: Enter in a field submits its form.
    if (
      down &&
      key === "Enter" &&
      target.form &&
      target.nodeName !== "TEXTAREA" &&
      typeof target.form.requestSubmit === "function"
    ) {
      target.form.requestSubmit()
      emulated = "form submit"
    }
    target.dispatchEvent(new KeyboardEvent("keyup", init))
    // The page heard the key, but a field didn't get its character.
    if (typing && isTextField(target)) return gap("key-typing", target)
    return done(op, el, emulated ? { emulated } : undefined)
  }

  async function driveScroll(op) {
    const show = isShow(op)
    let scroller = null
    if (op.target) {
      const el = driveTarget(op.target)
      if (!el) return { status: "not-found", target: op.target }
      if (show && (await showGlide(centerOf(el)))) return { status: "taken" }
      scroller = el
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
      if (scroller === document.documentElement) scroller = null
    }
    const by = { left: Number(op.dx) || 0, top: Number(op.dy) || 0 }
    if (show) {
      if (!op.target && (await showPause())) return { status: "taken" }
      by.behavior = "smooth"
    }
    if (scroller) scroller.scrollBy(by)
    else window.scrollBy(by)
    if (show) await wait(SHOW_SCROLL_MS)
    const scrolled = scroller
      ? { x: scroller.scrollLeft, y: scroller.scrollTop }
      : { x: scrollX, y: scrollY }
    return done(op, scroller, { scrolled })
  }

  async function driveSelect(op) {
    const show = isShow(op)
    const el = await driveTargetInView(op.target, show)
    if (!el) return { status: "not-found", target: op.target }
    const select =
      el.nodeName === "SELECT"
        ? el
        : (el.nodeName === "LABEL" && el.control) || el.querySelector("select")
    if (!select || select.nodeName !== "SELECT")
      throw new Error(
        "the target isn't a native select; click it, then click the option"
      )
    const want = String(op.value)
    const option = Array.from(select.options).find(
      (o) => o.value === want || o.textContent.trim() === want
    )
    if (!option) throw new Error("no option " + JSON.stringify(want))
    if (show) {
      if (await showGlide(centerOf(select))) return { status: "taken" }
      showPress()
    }
    setNativeValue(select, option.value)
    select.dispatchEvent(new Event("input", { bubbles: true }))
    select.dispatchEvent(new Event("change", { bubbles: true }))
    return done(op, select, { value: String(select.value) })
  }

  async function driveDrag(op) {
    const show = isShow(op)
    const el = await driveTargetInView(op.target, show)
    if (!el) return { status: "not-found", target: op.target }
    const toEl = driveTarget(op.to)
    if (!toEl) return { status: "not-found", target: op.to }
    const from = centerOf(el, op.target)
    const to = centerOf(toEl, op.to)
    if (show && (await showGlide(from))) return { status: "taken" }
    const steps = show ? SHOW_DRAG_STEPS : 8
    moveHover(el, from)
    firePointer(el, "pointerdown", from)
    fireMouse(el, "mousedown", from)
    // A draggable element takes the HTML5 route; anything else (sliders,
    // dnd-kit, canvases) moves on pointer events.
    const transfer =
      el.draggable && typeof DataTransfer === "function"
        ? new DataTransfer()
        : null
    const dragEvent = (type, p) =>
      new DragEvent(type, mouseInit(p, { dataTransfer: transfer }))
    if (transfer) el.dispatchEvent(dragEvent("dragstart", from))
    for (let i = 1; i <= steps; i++) {
      if (driveStopped) break
      const p = {
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
      }
      if (show) showFollow(p)
      const over = document.elementFromPoint(p.x, p.y) || toEl
      if (transfer) {
        over.dispatchEvent(dragEvent("dragenter", p))
        over.dispatchEvent(dragEvent("dragover", p))
      } else {
        firePointer(over, "pointermove", p)
        fireMouse(over, "mousemove", p)
      }
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
    const end = driveStopped ? from : to
    const dropOn = document.elementFromPoint(end.x, end.y) || toEl
    if (transfer) {
      if (!driveStopped) dropOn.dispatchEvent(dragEvent("drop", end))
      el.dispatchEvent(dragEvent("dragend", end))
    }
    firePointer(dropOn, "pointerup", end, { buttons: 0 })
    fireMouse(dropOn, "mouseup", end, { buttons: 0 })
    if (driveStopped) {
      clearHover()
      return { status: "taken" }
    }
    moveHover(dropOn, end)
    return done(op, el)
  }

  // Rest the pointer on the target: its hover handlers run and its hover
  // styles show, until the pointer moves on.
  async function driveHover(op) {
    const el = await driveTargetInView(op.target, isShow(op))
    if (!el) return { status: "not-found", target: op.target }
    const p = centerOf(el, op.target)
    if (isShow(op) && (await showGlide(p))) return { status: "taken" }
    const hit = document.elementFromPoint(p.x, p.y)
    moveHover(hit && el.contains(hit) ? hit : el, p)
    return done(op, el)
  }

  // A shared frame (#1396) is driven with real input over CDP: the bridge
  // only says where a target is, and readies a field for keys. Nothing here
  // acts on the page the way a gesture does.

  // Real presses, moves, keys and wheels the page has heard, so the service can
  // tell whether one reached it: a browser that just started drops them for
  // a moment. And drag-overs, so a drop waits for the page to accept one.
  const trustedInputs = {
    pointerdown: 0,
    pointermove: 0,
    keydown: 0,
    wheel: 0,
    dragover: 0,
  }
  const driveDocId = Math.random().toString(36).slice(2)
  Object.keys(trustedInputs).forEach((type) =>
    window.addEventListener(
      type,
      (e) => {
        if (e.isTrusted) trustedInputs[type]++
      },
      { capture: true, passive: true }
    )
  )

  function scrollerOf(el) {
    let scroller = el
    while (scroller && scroller !== document.documentElement) {
      const cs = getComputedStyle(scroller)
      if (
        /(auto|scroll)/.test(cs.overflowY + cs.overflowX) &&
        (scroller.scrollHeight > scroller.clientHeight ||
          scroller.scrollWidth > scroller.clientWidth)
      )
        return scroller
      scroller = scroller.parentElement
    }
    return null
  }

  function isDraggable(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement)
      if (n.draggable) return true
    return false
  }

  // Put the caret at the end of a field, or select all of it to replace.
  function caretIn(field, all) {
    field.focus({ preventScroll: true })
    if (isEditable(field)) {
      const range = document.createRange()
      range.selectNodeContents(field)
      if (!all) range.collapse(false)
      const sel = getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      return
    }
    try {
      if (all) field.select()
      else field.setSelectionRange(field.value.length, field.value.length)
    } catch {
      // Email and number fields have no selection range.
      if (all && field.select) field.select()
    }
  }

  // `focus`: "field" readies the text field the target names for typing
  // (`replace` selects what's in it), "element" focuses the target for a
  // key. `scroller`: the target's scrolling area. `inPlace`: don't scroll
  // the target into view (a drag's drop point). `show`: scroll it into view
  // smoothly, at show pace.
  async function driveLocate(d) {
    await parsed()
    const t = d.target
    let el =
      d.scroller || d.inPlace
        ? driveTarget(t)
        : await driveTargetInView(t, !!d.show)
    if (!el) return null
    const control = el.nodeName === "LABEL" && el.control ? el.control : el
    const out = {
      target: driveDescribe(el),
      file: control.nodeName === "INPUT" && control.type === "file",
      // A click there opens the browser's own popup, which the Mac's real
      // input can't answer either (#1385).
      popup:
        control.nodeName === "SELECT"
          ? "native-select"
          : control.nodeName === "INPUT" &&
              NATIVE_PICKER_TYPES.indexOf(control.type) !== -1
            ? "native-picker"
            : undefined,
      // Input there goes to a nested frame, which this page doesn't hear.
      nested: el.nodeName === "IFRAME",
      // Dragging it starts an HTML5 drag (a draggable element, a link, an
      // image), not just pointer moves.
      draggable: isDraggable(el),
    }
    if (d.focus === "field") {
      const field = textFieldOf(el)
      if (!field || !isTextField(field))
        return Object.assign(out, { x: 0, y: 0, field: false })
      caretIn(field, !!d.replace)
      el = field
      out.target = driveDescribe(field)
    } else if (d.focus === "element" && typeof el.focus === "function") {
      el.focus({ preventScroll: true })
    }
    if (d.scroller) {
      const scroller = scrollerOf(el)
      out.scroller = scroller ? cssPath(scroller) : null
      out.scrollerTarget = scroller ? driveDescribe(scroller) : null
      // The wheel goes to the visible middle of the scrolling area.
      const r = (scroller || document.documentElement).getBoundingClientRect()
      const left = Math.max(0, r.left)
      const top = Math.max(0, r.top)
      out.x = (left + Math.min(innerWidth, r.right)) / 2
      out.y = (top + Math.min(innerHeight, r.bottom)) / 2
      return out
    }
    const p = centerOf(el, t)
    out.x = p.x
    out.y = p.y
    return out
  }

  async function driveState(d) {
    await nextPaint()
    const out = {
      path: currentPath(),
      doc: driveDocId,
      inputs: Object.assign({}, trustedInputs),
      // Keys go to a nested frame, which this page doesn't hear.
      nestedFocus:
        !!document.activeElement &&
        document.activeElement.nodeName === "IFRAME",
    }
    if (d.selector) {
      const el = safeQuery(d.selector)
      if (el && "value" in el) out.value = String(el.value)
      else if (el && isEditable(el)) out.value = el.innerText
    }
    if (d.scroller !== undefined) {
      const s = d.scroller ? safeQuery(d.scroller) : null
      out.scrolled = s
        ? { x: s.scrollLeft, y: s.scrollTop }
        : { x: scrollX, y: scrollY }
    }
    return out
  }

  // The page's rendered DOM and its styles, optionally for one element. Scripts
  // are dropped (the result is for reading, not running), and so are the
  // style and link elements whose rules come back in `css`, inlined from the
  // CSSOM so a stylesheet the dev server built in memory is included. Rules
  // that can't style anything in the markup are left out to keep it small; a
  // cross-origin stylesheet can't be read, so it stays a link. Returns null
  // when the selector matches nothing.
  // `live`: for a screenshot rendered from the snapshot (a mockup the agent
  // drives on hosted, #1391), also carry the form state and the scroll, so
  // the render shows what was typed, ticked and picked, and where.
  function pageSnapshot(selector, live) {
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
    const shown = selector ? root : document.body || root
    const markup = shown.cloneNode(true)
    if (live) mirrorFormState(shown, markup)
    inlineBlobImages(shown, markup)
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
      ...(live
        ? {
            scroll: { x: window.scrollX, y: window.scrollY },
            viewport: { width: window.innerWidth, height: window.innerHeight },
          }
        : {}),
    }
  }

  // A Mockup's references (#1643) are blob: URLs only this page can load:
  // the snapshot carries their pictures as data: URLs instead.
  function inlineBlobImages(from, to) {
    const live = from.querySelectorAll("img")
    const copies = to.querySelectorAll("img")
    for (let i = 0; i < live.length && i < copies.length; i++) {
      const img = live[i]
      if (!img.currentSrc.startsWith("blob:") || !img.naturalWidth) continue
      try {
        const canvas = document.createElement("canvas")
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext("2d").drawImage(img, 0, 0)
        copies[i].setAttribute("src", canvas.toDataURL())
        copies[i].removeAttribute("srcset")
      } catch {
        // A picture that can't be drawn stays as it is.
      }
    }
  }

  // Form state lives in properties, which a clone's markup doesn't carry:
  // write it into the clone's attributes.
  function mirrorFormState(from, to) {
    const fields = "input, textarea, select"
    const live = from.querySelectorAll(fields)
    const copies = to.querySelectorAll(fields)
    for (let i = 0; i < live.length && i < copies.length; i++) {
      const field = live[i]
      const copy = copies[i]
      if (field.tagName === "TEXTAREA") {
        copy.textContent = field.value
      } else if (field.tagName === "SELECT") {
        Array.from(copy.options).forEach((option, j) => {
          option.toggleAttribute("selected", !!field.options[j]?.selected)
        })
      } else if (field.type === "checkbox" || field.type === "radio") {
        copy.toggleAttribute("checked", field.checked)
      } else if (field.type !== "file") {
        copy.setAttribute("value", field.value)
      }
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

  // The page's content extent, for Fit to content. Plain
  // scrollWidth/scrollHeight is `max(viewport, content)`, so when the artboard
  // is already larger than its content it just echoes the current size and
  // Fit becomes a no-op. Walking elements and taking the union of their
  // viewport-relative rects (plus current scroll) gives the actual content
  // bounds, regardless of viewport size.
  function contentSize() {
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
    return { width: width, height: height }
  }

  // Fit to content left on: report the content's size as it changes, so the
  // canvas can keep the frame's height on it. A change that only the
  // viewport's height made (the canvas just resized the frame) isn't
  // reported: content sized in vh would otherwise grow the frame forever.
  let contentWatch = null
  function watchContentSize(on) {
    if (!on) {
      if (contentWatch) contentWatch.stop()
      contentWatch = null
      return
    }
    if (contentWatch) return
    let lastWidth = window.innerWidth
    let lastHeight = window.innerHeight
    let lastReported = null
    let mutated = true
    let timer = null
    function measure() {
      timer = null
      const viewportOnly =
        !mutated &&
        window.innerWidth === lastWidth &&
        window.innerHeight !== lastHeight
      mutated = false
      lastWidth = window.innerWidth
      lastHeight = window.innerHeight
      if (viewportOnly && lastReported !== null) return
      const size = contentSize()
      const height = Math.ceil(size.height)
      if (height === lastReported) return
      lastReported = height
      parent.postMessage(
        { type: "screenplay:content-size", width: size.width, height: height },
        "*"
      )
    }
    function schedule() {
      if (!timer) timer = setTimeout(measure, 100)
    }
    const mutations = new MutationObserver(() => {
      mutated = true
      schedule()
    })
    mutations.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
    // Images and fonts loading resize the body without a mutation.
    const resizes =
      typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null
    if (resizes && document.body) resizes.observe(document.body)
    window.addEventListener("resize", schedule)
    window.addEventListener("load", schedule)
    schedule()
    contentWatch = {
      stop() {
        if (timer) clearTimeout(timer)
        mutations.disconnect()
        if (resizes) resizes.disconnect()
        window.removeEventListener("resize", schedule)
        window.removeEventListener("load", schedule)
      },
    }
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

  // Space with the pointer outside the preview. A canvas pans on space-drag,
  // but once the user has clicked into an interactive frame the key lands
  // here. While the pointer is out over the canvas, a Space nobody is typing
  // goes to the canvas instead, so space-drag pans there. With the pointer over
  // the page, or in a text field, Space stays the page's.
  let pointerInPage = true
  // `mouseout` with no related target: the pointer left the page's window.
  window.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget) pointerInPage = false
  })
  window.addEventListener("mouseover", () => {
    pointerInPage = true
  })
  let spaceForwarded = false
  function isTextEntry(el) {
    if (!el || !(el instanceof Element)) return false
    if (el.isContentEditable) return true
    if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true
    if (el.tagName !== "INPUT") return false
    const type = (el.getAttribute("type") || "text").toLowerCase()
    return ![
      "button",
      "checkbox",
      "color",
      "file",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(type)
  }
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== " " || e.isComposing) return
      if (spaceForwarded) {
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }
      if (pointerInPage || e.repeat) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTextEntry(document.activeElement)) return
      // Claim it before the page sees it: no scroll, no button press.
      e.preventDefault()
      e.stopImmediatePropagation()
      spaceForwarded = true
      parent.postMessage({ type: "screenplay:space-down" }, "*")
    },
    true
  )
  window.addEventListener(
    "keyup",
    (e) => {
      if (e.key !== " " || !spaceForwarded) return
      e.preventDefault()
      e.stopImmediatePropagation()
      spaceForwarded = false
      parent.postMessage({ type: "screenplay:space-up" }, "*")
    },
    true
  )
  // A press on the canvas mid-hold moves focus out of the page, so the canvas
  // hears the real keyup itself; just forget the hold here.
  window.addEventListener("blur", () => {
    spaceForwarded = false
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
