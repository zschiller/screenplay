;(() => {
  // Knobs for Mockup pages (static HTML a chat writes, #1309). A frame's app
  // declares knobs with `@screenplay.space/knobs`; a Mockup has no bundler or
  // React, so this script, inlined into every Mockup's srcdoc ahead of the
  // page's own scripts, gives it the same protocol as a global:
  //
  //   screenplay.registerKnob(def, onChange)
  //
  // `def` is the package's knob definition ({ id, type, label?, default, … });
  // `onChange(value)` runs at once with the current value and again on every
  // change from the canvas. Every value is also written to `:root` as the CSS
  // custom property `--knob-<id>`, so a page can use a knob from CSS alone.
  if (window.screenplay && window.screenplay.registerKnob) return

  const definitions = new Map()
  const values = new Map()
  const listeners = new Map()
  let publishScheduled = false

  function coerce(def, raw) {
    switch (def.type) {
      case "number":
      case "slider":
        return typeof raw === "number" ? raw : def.default
      case "boolean":
        return typeof raw === "boolean" ? raw : def.default
      case "string":
      case "color":
        return typeof raw === "string" ? raw : def.default
      case "select":
      case "tabs":
        return typeof raw === "string" &&
          Array.isArray(def.options) &&
          def.options.some((o) => o && o.value === raw)
          ? raw
          : def.default
      default:
        return def.default
    }
  }

  function cssValue(value) {
    if (typeof value === "string") return value
    return String(value)
  }

  function apply(id, value) {
    values.set(id, value)
    try {
      document.documentElement.style.setProperty(
        "--knob-" + id,
        cssValue(value)
      )
    } catch {}
    for (const cb of listeners.get(id) || []) {
      try {
        cb(value)
      } catch (e) {
        console.error(e)
      }
    }
  }

  function publish() {
    if (publishScheduled) return
    publishScheduled = true
    Promise.resolve().then(() => {
      publishScheduled = false
      parent.postMessage(
        {
          type: "screenplay:knobs-declared",
          knobs: [...definitions.values()],
        },
        "*"
      )
    })
  }

  function registerKnob(def, onChange) {
    if (!def || typeof def.id !== "string" || typeof def.type !== "string") {
      throw new Error("registerKnob needs a definition with an id and a type")
    }
    // Functions don't cross frames; keep only what the canvas can draw.
    const clean = JSON.parse(JSON.stringify(def))
    definitions.set(def.id, clean)
    if (!values.has(def.id)) apply(def.id, coerce(clean, clean.default))
    if (typeof onChange === "function") {
      if (!listeners.has(def.id)) listeners.set(def.id, new Set())
      listeners.get(def.id).add(onChange)
      onChange(values.get(def.id))
    }
    publish()
    return values.get(def.id)
  }

  window.addEventListener("message", (e) => {
    const data = e.data
    if (!data || data.type !== "screenplay:knob-values") return
    if (!data.values || typeof data.values !== "object") return
    for (const [id, raw] of Object.entries(data.values)) {
      const def = definitions.get(id)
      if (!def) continue
      const value = coerce(def, raw)
      if (values.get(id) !== value) apply(id, value)
    }
  })

  // A page that declares no knobs (or no longer does, after a rewrite) says
  // so once it has loaded, so the canvas drops any it declared before.
  window.addEventListener("load", () => {
    if (definitions.size === 0) publish()
  })

  window.screenplay = Object.assign(window.screenplay || {}, {
    registerKnob,
    getKnobValue: (id) => values.get(id),
  })
})()
