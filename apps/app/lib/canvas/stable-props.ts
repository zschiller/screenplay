import { useState } from "react"

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
 * Anything else (class instances, Maps, Sets, React elements, refs) keeps
 * its own identity. Keys name an item and a prop path (`frame-1.placement.onMove`), so
 * two items never share a stub. A list calls {@link StableProps.sweep} once per
 * render after its last {@link StableProps.value} to drop the entries of items
 * that are gone.
 */
export class StableProps {
  private roots = new Map<string, Node>()
  private seen = new Set<string>()

  /** `value` stabilized under `key` (see the class comment). */
  value<T>(key: string, value: T): T {
    this.seen.add(key)
    let root = this.roots.get(key)
    if (!root) {
      root = newNode()
      this.roots.set(key, root)
    }
    return stable(root, value) as T
  }

  /** Forget every key not used since the previous sweep. */
  sweep(): void {
    for (const key of this.roots.keys())
      if (!this.seen.has(key)) this.roots.delete(key)
    this.seen.clear()
  }
}

type Fn = (...args: never[]) => unknown

/**
 * One prop path's state: its stub and the latest function, or the last value
 * in and the stable value out, and its children by key. A tree rather than a
 * map of path strings, so a render builds no strings.
 */
interface Node {
  latest: Fn | undefined
  stub: Fn | undefined
  input: unknown
  output: unknown
  /** The key count of `output`, when it's a plain object. */
  keyCount: number
  children: Map<string | number, Node> | undefined
}

function newNode(): Node {
  return {
    latest: undefined,
    stub: undefined,
    input: undefined,
    output: undefined,
    keyCount: -1,
    children: undefined,
  }
}

function childOf(node: Node, key: string | number): Node {
  node.children ??= new Map()
  let child = node.children.get(key)
  if (!child) {
    child = newNode()
    node.children.set(key, child)
  }
  return child
}

function stable(node: Node, value: unknown): unknown {
  if (typeof value === "function") return stub(node, value as Fn)
  if (Array.isArray(value)) {
    // The same array as last time holds the same values and functions.
    if (node.input === value) return node.output
    const last = node.output
    const prev =
      Array.isArray(last) && last.length === value.length ? last : null
    // Built only once an item differs: an equal array allocates nothing.
    let out: unknown[] | null = prev ? null : []
    for (let i = 0; i < value.length; i++) {
      const item = stable(childOf(node, i), value[i])
      if (out) out.push(item)
      else if (!Object.is(item, prev![i])) {
        out = prev!.slice(0, i)
        out.push(item)
      }
    }
    node.input = value
    node.output = out ?? prev
    node.keyCount = -1
    return node.output
  }
  if (!isPlainObject(value)) return value
  if (node.input === value) return node.output
  const last = node.output
  const keys = Object.keys(value)
  const prev =
    node.keyCount === keys.length &&
    isPlainObject(last) &&
    keys.every((k) => Object.hasOwn(last, k))
      ? last
      : null
  let out: Record<string, unknown> | null = prev ? null : {}
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!
    const v = stable(childOf(node, k), value[k])
    if (out) out[k] = v
    else if (!Object.is(v, prev![k])) {
      out = {}
      for (let j = 0; j < i; j++) out[keys[j]!] = prev![keys[j]!]
      out[k] = v
    }
  }
  node.input = value
  node.output = out ?? prev
  node.keyCount = keys.length
  return node.output
}

function stub(node: Node, f: Fn): Fn {
  node.latest = f
  if (!node.stub) {
    const n = node
    node.stub = (...args: never[]) => n.latest?.(...args)
  }
  return node.stub
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false
  // React elements are plain objects too, but their identity is what React
  // compares: leave them be.
  if ("$$typeof" in value) return false
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return false
  // A ref (`{ current }`) is read and written through its own identity: a
  // copy would freeze what it pointed at.
  for (const key in value) if (key !== "current") return true
  return !("current" in value)
}

/**
 * One value kept stable across renders by {@link StableProps}: the same
 * object until something in it changes, its functions stubs that call the
 * latest.
 */
export function useStableValue<T>(value: T): T {
  const [stable] = useState(() => new StableProps())
  return stable.value("value", value)
}
