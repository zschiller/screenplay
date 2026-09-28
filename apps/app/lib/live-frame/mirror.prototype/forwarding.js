// PROTOTYPE (#982). Input forwarding for the mirrored route.
//
// The live copy of a frame runs in one tab (the host). Everyone else sees an
// rrweb mirror of it. When someone else drives, their clicks, typing and
// scrolling on the mirror are turned into small messages that name the target
// by its rrweb node id (the same id on both sides, because the mirror is
// rebuilt from the host's snapshot), relayed to the host, and replayed there
// as synthetic DOM events.
//
// Three pieces, kept free of relay and UI code so they could lift into the
// Sandbox Bridge (host side) and the canvas (watcher side):
//   captureInput(event, idOf)   watcher: DOM event on the mirror -> message
//   shouldApply(room, message)  host: only the current driver's input lands
//   applyInput(win, nodeOf, m)  host: message -> synthetic events in the frame

const TEXT_TYPES = new Set(["", "text", "search", "email", "url", "tel", "password", "number"])

function isTextField(el) {
  if (!el || !el.tagName) return false
  if (el.tagName === "TEXTAREA") return true
  if (el.tagName !== "INPUT") return false
  return TEXT_TYPES.has((el.getAttribute("type") || "").toLowerCase())
}

// Keys that mean something beyond inserting a character. Characters typed
// into a text field travel as the field's value instead (see "value").
const COMMAND_KEYS = new Set(["Escape", "Enter", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown", " "])

/**
 * Turn one DOM event on the watcher's mirror into a forwardable message, or
 * null when it isn't input the host needs. The caller stamps `from` and sends.
 * `idOf(node)` is the replayer mirror's id lookup.
 */
export function captureInput(event, idOf) {
  const t = event.target
  switch (event.type) {
    case "click": {
      const el = t.nodeType === 1 ? t : t.parentElement
      const r = el.getBoundingClientRect()
      return {
        kind: "click",
        id: idOf(el),
        ox: r.width ? (event.clientX - r.left) / r.width : 0.5,
        oy: r.height ? (event.clientY - r.top) / r.height : 0.5,
      }
    }
    case "input":
      if (isTextField(t) || (t.tagName === "INPUT" && t.type === "range")) {
        return { kind: "value", id: idOf(t), value: t.value }
      }
      return null
    case "change":
      if (t.tagName === "SELECT") return { kind: "value", id: idOf(t), value: t.value }
      return null
    case "keydown": {
      const inText = isTextField(t)
      if (inText && !COMMAND_KEYS.has(event.key)) return null
      if (inText && (event.key === "Backspace" || event.key === "Delete" || event.key === " ")) return null
      return { kind: "key", id: idOf(t), key: event.key, code: event.code }
    }
    case "scroll": {
      const doc = t.nodeType === 9 ? t : null
      const el = doc ? doc.scrollingElement : t
      return { kind: "scroll", id: idOf(doc || t), x: el.scrollLeft, y: el.scrollTop }
    }
    case "pointermove": {
      const el = t.nodeType === 1 ? t : t.parentElement
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        kind: "move",
        id: idOf(el),
        ox: r.width ? (event.clientX - r.left) / r.width : 0.5,
        oy: r.height ? (event.clientY - r.top) / r.height : 0.5,
      }
    }
    default:
      return null
  }
}

/** #981: only the driver's input reaches the frame. Watchers' input never does. */
export function shouldApply(room, message) {
  return Boolean(room.driver) && message.from === room.driver
}

function point(win, el, ox, oy) {
  const r = el.getBoundingClientRect()
  return { clientX: r.left + ox * r.width, clientY: r.top + oy * r.height }
}

let lastHover = null

/**
 * Replay one forwarded message inside the host frame. Returns what happened,
 * for the prototype's log: "applied", "missing" (the node is gone, e.g. the
 * host re-rendered between the watcher's click and its arrival), or "ignored".
 */
export function applyInput(win, nodeOf, m) {
  const doc = win.document
  const node = m.id == null ? null : nodeOf(m.id)
  switch (m.kind) {
    case "click": {
      if (!node || node.nodeType !== 1) return "missing"
      const base = { bubbles: true, cancelable: true, composed: true, view: win, button: 0, ...point(win, node, m.ox, m.oy) }
      const ptr = { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true }
      node.dispatchEvent(new PointerEvent("pointerdown", ptr))
      node.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }))
      if (typeof node.focus === "function") node.focus({ preventScroll: true })
      node.dispatchEvent(new PointerEvent("pointerup", ptr))
      node.dispatchEvent(new MouseEvent("mouseup", base))
      // A dispatched click still runs the element's activation behaviour:
      // links navigate, checkboxes toggle, summaries open, submit buttons submit.
      node.dispatchEvent(new MouseEvent("click", { ...base, detail: 1 }))
      return "applied"
    }
    case "value": {
      if (!node) return "missing"
      const proto = Object.getPrototypeOf(node)
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
      // Go through the prototype's setter so React's value tracker sees a change.
      if (setter) setter.call(node, m.value)
      else node.value = m.value
      node.dispatchEvent(new Event("input", { bubbles: true }))
      node.dispatchEvent(new Event("change", { bubbles: true }))
      return "applied"
    }
    case "key": {
      const target = (node && node.nodeType === 1 ? node : null) || doc.activeElement || doc.body
      const init = { key: m.key, code: m.code, bubbles: true, cancelable: true, composed: true, view: win }
      target.dispatchEvent(new KeyboardEvent("keydown", init))
      target.dispatchEvent(new KeyboardEvent("keyup", init))
      // A synthetic Escape doesn't run the browser's own behaviour, so a
      // native modal <dialog> would stay open. Do what the browser would.
      if (m.key === "Escape") {
        const open = [...doc.querySelectorAll("dialog")].filter((d) => d.matches(":modal"))
        const top = open[open.length - 1]
        if (top && top.dispatchEvent(new Event("cancel", { cancelable: true }))) top.close()
      }
      return "applied"
    }
    case "scroll": {
      if (!node) return "missing"
      if (node.nodeType === 9) win.scrollTo(m.x, m.y)
      else node.scrollTo(m.x, m.y)
      return "applied"
    }
    case "move": {
      if (!node || node.nodeType !== 1) return "missing"
      const base = { bubbles: true, cancelable: true, composed: true, view: win, ...point(win, node, m.ox, m.oy) }
      if (lastHover !== node) {
        if (lastHover) lastHover.dispatchEvent(new MouseEvent("mouseout", { ...base, relatedTarget: node }))
        node.dispatchEvent(new MouseEvent("mouseover", { ...base, relatedTarget: lastHover }))
        lastHover = node
      }
      node.dispatchEvent(new PointerEvent("pointermove", { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true }))
      node.dispatchEvent(new MouseEvent("mousemove", base))
      return "applied"
    }
    default:
      return "ignored"
  }
}
