/**
 * Keeps per-item props referentially stable across renders that don't change
 * them, so a list of `memo`-wrapped items (the canvas's Layers) bails out
 * instead of re-rendering every item whenever the list re-renders.
 *
 * A list that builds its items' props inline hands every item fresh callbacks
 * and fresh objects each render, which defeats `memo`. {@link StableProps.value}
 * fixes both without touching the item components:
 *
 *  - **Functions** become a stub that is stable per key and always calls the
 *    function from the latest render, so an item never runs a stale closure.
 *  - **Plain objects and arrays** are compared by value (their functions
 *    stubbed the same way) and the previous one is returned when equal.
 *
 * Anything else (class instances, Maps, Sets, React elements) keeps its own
 * identity. Keys name an item and a prop path (`frame-1.placement.onMove`), so
 * two items never share a stub. A list calls {@link StableProps.sweep} once per
 * render after its last {@link StableProps.value} to drop the entries of items
 * that are gone.
 */
export class StableProps {
  private roots = new Map<string, Root>()
  private seen = new Set<string>()

  /** `value` stabilized under `key` (see the class comment). */
  value<T>(key: string, value: T): T {
    this.seen.add(key)
    let root = this.roots.get(key)
    if (!root) {
      root = { latest: new Map(), stubs: new Map(), values: new Map() }
      this.roots.set(key, root)
    }
    return stable(root, "", value) as T
  }

  /** Forget every key not used since the previous sweep. */
  sweep(): void {
    for (const key of this.roots.keys())
      if (!this.seen.has(key)) this.roots.delete(key)
    this.seen.clear()
  }
}

type Fn = (...args: never[]) => unknown

/** One key's stubs and values, by prop path. */
interface Root {
  latest: Map<string, Fn>
  stubs: Map<string, Fn>
  /** The last value in and the stable value out. */
  values: Map<string, { input: unknown; output: unknown }>
}

function stable(root: Root, path: string, value: unknown): unknown {
  if (typeof value === "function") return stub(root, path, value as Fn)
  const isArray = Array.isArray(value)
  if (!isArray && !isPlainObject(value)) return value
  const last = root.values.get(path)
  // The same object as last time holds the same values and functions.
  if (last?.input === value) return last.output
  const next = isArray
    ? value.map((item, i) => stable(root, `${path}.${i}`, item))
    : Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [
          k,
          stable(root, `${path}.${k}`, v),
        ])
      )
  const output =
    last !== undefined && shallowEqual(last.output, next) ? last.output : next
  root.values.set(path, { input: value, output })
  return output
}

function stub(root: Root, path: string, f: Fn): Fn {
  root.latest.set(path, f)
  let s = root.stubs.get(path)
  if (!s) {
    const latest = root.latest
    s = (...args: never[]) => latest.get(path)?.(...args)
    root.stubs.set(path, s)
  }
  return s
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false
  // React elements are plain objects too, but their identity is what React
  // compares: leave them be.
  if ("$$typeof" in value) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, i) => Object.is(item, b[i]))
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((k) => Object.hasOwn(b, k) && Object.is(a[k], b[k]))
}
