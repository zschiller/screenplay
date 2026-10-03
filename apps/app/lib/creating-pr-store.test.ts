import { describe, expect, it, vi } from "vitest"

import { creatingPrStore } from "./creating-pr-store"

describe("creatingPrStore", () => {
  it("holds a Workspace pending until its create settles, and runs one at a time", async () => {
    let settle!: (n: number) => void
    const create = vi.fn(() => new Promise<number>((r) => (settle = r)))
    const listener = vi.fn()
    const unsubscribe = creatingPrStore.subscribe(listener)

    const first = creatingPrStore.run("b1", create)
    expect(creatingPrStore.has("b1")).toBe(true)
    expect(creatingPrStore.has("b2")).toBe(false)
    expect(await creatingPrStore.run("b1", create)).toBeUndefined()
    expect(create).toHaveBeenCalledTimes(1)

    settle(7)
    expect(await first).toBe(7)
    expect(creatingPrStore.has("b1")).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it("clears the Workspace when the create throws", async () => {
    await expect(
      creatingPrStore.run("b1", () => Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom")
    expect(creatingPrStore.has("b1")).toBe(false)
  })
})
