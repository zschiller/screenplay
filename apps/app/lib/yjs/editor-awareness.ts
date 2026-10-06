import type { AwarenessChange, AwarenessLike } from "@/lib/yjs/context"

/** The awareness fields an editor's carets read: who, and where in the text. */
const EDITOR_FIELDS = ["user", "cursor"] as const

type AwarenessEvent = "change" | "update"
type Listener = (changes?: AwarenessChange, ...rest: unknown[]) => void

/**
 * The room's awareness as a Document's editor sees it: the same object, except
 * that its `change` and `update` listeners hear only of carets, names, and
 * people arriving or leaving. The canvas writes the pointer to the awareness
 * on every pointer move, and the editor's caret plugin answers each change
 * with a transaction, in every Document on the canvas; through this it
 * answers only when a caret could have moved.
 */
export function editorAwareness<T extends AwarenessLike>(awareness: T): T {
  const fieldsOf = (id: number) => {
    const state = awareness.getStates().get(id) as
      Record<string, unknown> | undefined
    return JSON.stringify(EDITOR_FIELDS.map((k) => state?.[k] ?? null))
  }

  // Per event, since `change` and `update` each report a set separately:
  // each client's caret fields as last passed on, and each emit's verdict, so
  // all of an event's listeners hear the same emits.
  const events = {
    change: { seen: new Map<number, string>(), verdicts: new WeakMap() },
    update: { seen: new Map<number, string>(), verdicts: new WeakMap() },
  } satisfies Record<
    AwarenessEvent,
    { seen: Map<number, string>; verdicts: WeakMap<object, boolean> }
  >
  const passes = (event: AwarenessEvent, changes?: AwarenessChange) => {
    if (!changes) return true
    const { seen, verdicts } = events[event]
    const known = verdicts.get(changes)
    if (known !== undefined) return known
    let pass = changes.added.length > 0 || changes.removed.length > 0
    for (const id of changes.removed) seen.delete(id)
    for (const id of [...changes.added, ...changes.updated]) {
      const fields = fieldsOf(id)
      if (seen.get(id) !== fields) {
        seen.set(id, fields)
        pass = true
      }
    }
    verdicts.set(changes, pass)
    return pass
  }

  // One wrapper per event and listener, so `off` finds what `on` added.
  const wrappers = new Map<string, Map<Listener, Listener>>()
  const wrapperOf = (event: AwarenessEvent, listener: Listener) => {
    let byListener = wrappers.get(event)
    if (!byListener) wrappers.set(event, (byListener = new Map()))
    let w = byListener.get(listener)
    if (!w) {
      w = (changes, ...rest) => {
        if (passes(event, changes)) listener(changes, ...rest)
      }
      byListener.set(listener, w)
    }
    return w
  }
  const on = (event: AwarenessEvent, listener: Listener) =>
    awareness.on(event, wrapperOf(event, listener))
  const off = (event: AwarenessEvent, listener: Listener) => {
    const w = wrappers.get(event)?.get(listener)
    if (w) awareness.off(event, w)
  }

  return new Proxy(awareness, {
    get(target, key) {
      if (key === "on") return on
      if (key === "off") return off
      const value: unknown = Reflect.get(target, key)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}
