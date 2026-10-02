;(() => {
  // Shared state for Mockup pages (#1309), the static-page twin of
  // `@screenplay.space/state`, inlined into every Mockup's srcdoc ahead of the
  // page's own scripts:
  //
  //   const count = screenplay.shareState("count", 0, (value) => render(value))
  //   count.set(count.get() + 1)
  //
  // Values under each key sync through the canvas to everyone viewing the
  // Mockup. `onChange` runs at once with the current value, then on every
  // change, local `set` included, so one render path covers both. On load the
  // page asks the canvas for the room's state first, and takes the room's
  // value over its own default.
  if (window.screenplay && window.screenplay.shareState) return

  const MAX_PAYLOAD_BYTES = 64 * 1024
  const ROOM_ANSWER_TIMEOUT_MS = 500
  // Serialized value per key; JSON in and out keeps every value cloneable.
  const entries = new Map()
  const listeners = new Map()
  // The room's state once the canvas has answered, null until then: nothing
  // publishes before it, so a page's defaults never overwrite the room's.
  let room = null
  let publishScheduled = false

  function serialize(value) {
    try {
      const out = JSON.stringify(value)
      return typeof out === "string" ? out : null
    } catch {
      return null
    }
  }

  function valueOf(key) {
    return entries.has(key) ? JSON.parse(entries.get(key)) : undefined
  }

  function notify(key) {
    const value = valueOf(key)
    for (const cb of listeners.get(key) || []) {
      try {
        cb(value)
      } catch (e) {
        console.error(e)
      }
    }
  }

  function publish() {
    if (room === null || publishScheduled) return
    publishScheduled = true
    Promise.resolve().then(() => {
      publishScheduled = false
      const out = {}
      for (const key of entries.keys()) out[key] = valueOf(key)
      const serialized = serialize(out)
      if (serialized === null) return
      if (serialized.length > MAX_PAYLOAD_BYTES) {
        console.warn(
          `[screenplay] shared state exceeds ${MAX_PAYLOAD_BYTES} bytes; dropping. Share a smaller summary.`
        )
        return
      }
      room = out
      parent.postMessage({ type: "screenplay:shared-state", state: out }, "*")
    })
  }

  // Take the room's value for `key` when it holds a different one. Returns
  // true when it did.
  function adopt(key) {
    if (!room || !Object.prototype.hasOwnProperty.call(room, key)) return false
    const serialized = serialize(room[key])
    if (serialized === null || serialized === entries.get(key)) return false
    entries.set(key, serialized)
    return true
  }

  function shareState(key, initial, onChange) {
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("shareState needs a non-empty string key")
    }
    if (typeof onChange === "function") {
      if (!listeners.has(key)) listeners.set(key, new Set())
      listeners.get(key).add(onChange)
    }
    if (!entries.has(key)) {
      const serialized = serialize(initial)
      if (serialized !== null) entries.set(key, serialized)
    }
    if (room !== null && !adopt(key)) publish()
    if (typeof onChange === "function") onChange(valueOf(key))
    return {
      get: () => valueOf(key),
      set(value) {
        const serialized = serialize(value)
        if (serialized === null || serialized === entries.get(key)) return
        entries.set(key, serialized)
        notify(key)
        publish()
      },
    }
  }

  function roomAnswered(state) {
    if (room !== null) return
    room = state
    for (const key of entries.keys()) if (adopt(key)) notify(key)
    publish()
  }

  window.addEventListener("message", (e) => {
    const data = e.data
    if (!data || data.type !== "screenplay:shared-state-apply") return
    const incoming = data.state
    if (!incoming || typeof incoming !== "object") return
    if (room === null) {
      roomAnswered(incoming)
      return
    }
    room = incoming
    for (const [key, value] of Object.entries(incoming)) {
      const serialized = serialize(value)
      if (serialized === null || serialized === entries.get(key)) continue
      entries.set(key, serialized)
      notify(key)
    }
  })
  parent.postMessage({ type: "screenplay:shared-state-request" }, "*")
  setTimeout(() => roomAnswered({}), ROOM_ANSWER_TIMEOUT_MS)

  window.screenplay = Object.assign(window.screenplay || {}, { shareState })
})()
