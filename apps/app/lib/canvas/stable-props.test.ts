import { describe, expect, it, vi } from "vitest"

import { StableProps } from "./stable-props"

describe("StableProps", () => {
  it("keeps props that come out the same", () => {
    const stable = new StableProps()
    const make = () => ({
      zoom: 1,
      placement: { worldX: 10, worldY: 20 },
      sizes: [{ width: 1280 }, { width: 402 }],
    })
    const first = stable.value("a", make())
    const second = stable.value("a", make())
    expect(second).toBe(first)
    expect(second.placement).toBe(first.placement)
    expect(second.sizes).toBe(first.sizes)
  })

  it("replaces only what changed", () => {
    const stable = new StableProps()
    const first = stable.value("a", {
      placement: { worldX: 10 },
      label: { text: "Cart" },
    })
    const second = stable.value("a", {
      placement: { worldX: 11 },
      label: { text: "Cart" },
    })
    expect(second).not.toBe(first)
    expect(second.placement).toEqual({ worldX: 11 })
    expect(second.label).toBe(first.label)
  })

  it("gives each callback one stub that calls the latest", () => {
    const stable = new StableProps()
    const old = vi.fn()
    const latest = vi.fn()
    const first = stable.value("a", { onMove: old, nested: { onDrop: old } })
    const second = stable.value("a", {
      onMove: latest,
      nested: { onDrop: latest },
    })
    expect(second.onMove).toBe(first.onMove)
    expect(second.nested).toBe(first.nested)
    first.onMove()
    first.nested.onDrop()
    expect(old).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(2)
  })

  it("keeps keys apart", () => {
    const stable = new StableProps()
    const a = vi.fn()
    const b = vi.fn()
    stable.value("a", { onMove: a }).onMove()
    stable.value("b", { onMove: b }).onMove()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it("leaves Maps, Sets, class instances and elements as they are", () => {
    const stable = new StableProps()
    const ids = new Set(["a"])
    const element = { $$typeof: Symbol.for("react.element"), props: {} }
    const first = stable.value("a", { ids, element })
    const second = stable.value("a", {
      ids: new Set(["a"]),
      element: { ...element },
    })
    expect(first.ids).toBe(ids)
    expect(second.ids).not.toBe(ids)
    expect(second.element).not.toBe(first.element)
  })

  it("drops a key that a render skipped", () => {
    const stable = new StableProps()
    const first = stable.value("a", { x: { y: 1 } })
    stable.sweep()
    stable.value("b", {})
    stable.sweep()
    expect(stable.value("a", { x: { y: 1 } }).x).not.toBe(first.x)
  })
})
