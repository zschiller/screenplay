(() => {
  if (window.__screenplayBridge) return
  window.__screenplayBridge = true

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
  let pickOutline = null
  let pickMoveHandler = null
  let pickClickHandler = null

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
    pickOutline = document.createElement("div")
    Object.assign(pickOutline.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "2147483647",
      outline: "2px solid #3b82f6",
      outlineOffset: "0px",
      background: "rgba(59, 130, 246, 0.1)",
      transition: "none",
      display: "none",
    })
    document.documentElement.appendChild(pickOverlay)
    document.documentElement.appendChild(pickOutline)
  }

  function removePickUi() {
    if (pickOverlay) { pickOverlay.remove(); pickOverlay = null }
    if (pickOutline) { pickOutline.remove(); pickOutline = null }
  }

  function elementUnderPointer(x, y) {
    if (!pickOverlay) return null
    pickOverlay.style.pointerEvents = "none"
    const el = document.elementFromPoint(x, y)
    pickOverlay.style.pointerEvents = "auto"
    return el && el !== pickOverlay && el !== pickOutline ? el : null
  }

  function startPick() {
    if (pickMoveHandler) return
    ensurePickUi()
    pickMoveHandler = (e) => {
      const el = elementUnderPointer(e.clientX, e.clientY)
      if (!el) { pickOutline.style.display = "none"; return }
      const r = el.getBoundingClientRect()
      Object.assign(pickOutline.style, {
        display: "block",
        left: r.x + "px",
        top: r.y + "px",
        width: r.width + "px",
        height: r.height + "px",
      })
    }
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
      stopPick()
    }
    pickOverlay.addEventListener("mousemove", pickMoveHandler)
    pickOverlay.addEventListener("click", pickClickHandler, true)
  }

  function stopPick() {
    if (pickOverlay && pickMoveHandler) pickOverlay.removeEventListener("mousemove", pickMoveHandler)
    if (pickOverlay && pickClickHandler) pickOverlay.removeEventListener("click", pickClickHandler, true)
    pickMoveHandler = null
    pickClickHandler = null
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
        } else {
          reply(d.id, false, "unknown op: " + d.op)
        }
      } else if (d.type === "screenplay:pick-start") {
        startPick()
        reply(d.id, true, null)
      } else if (d.type === "screenplay:pick-stop") {
        stopPick()
        reply(d.id, true, null)
      }
    } catch (err) {
      reply(d.id, false, (err && err.message) || err)
    }
  })

  parent.postMessage({ type: "screenplay:ready" }, "*")
})()
