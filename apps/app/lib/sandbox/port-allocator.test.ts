import { describe, expect, it } from "vitest"

import { PortAllocator } from "@/lib/sandbox/port-allocator"

describe("PortAllocator", () => {
  it("hands out a usable localhost port", async () => {
    const ports = new PortAllocator()
    const port = await ports.allocate("branch-a")
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThan(65536)
  })

  it("is idempotent per key — the same key keeps its port", async () => {
    const ports = new PortAllocator()
    const first = await ports.allocate("branch-a")
    const second = await ports.allocate("branch-a")
    expect(second).toBe(first)
    expect(ports.get("branch-a")).toBe(first)
  })

  it("gives distinct ports to distinct keys", async () => {
    const ports = new PortAllocator()
    const handed = await Promise.all(
      Array.from({ length: 20 }, (_, i) => ports.allocate(`branch-${i}`))
    )
    expect(new Set(handed).size).toBe(handed.length)
  })

  it("reclaims a port on release so the key is forgotten", async () => {
    const ports = new PortAllocator()
    await ports.allocate("branch-a")
    expect(ports.get("branch-a")).toBeDefined()

    ports.release("branch-a")
    expect(ports.get("branch-a")).toBeUndefined()
  })

  it("treats releasing an unknown key as a no-op", () => {
    const ports = new PortAllocator()
    expect(() => ports.release("never-allocated")).not.toThrow()
  })

  it("can re-assign a key after release", async () => {
    const ports = new PortAllocator()
    const first = await ports.allocate("branch-a")
    ports.release("branch-a")
    const second = await ports.allocate("branch-a")
    expect(second).toBeGreaterThan(0)
    // It's a fresh assignment, not the stale one.
    expect(ports.get("branch-a")).toBe(second)
    void first
  })
})
