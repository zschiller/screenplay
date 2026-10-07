import net from "node:net"

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

describe("PortAllocator with a preview port range", () => {
  const range = (from: number) => ({ from, to: from + 2 })
  // A range high in the ephemeral space, offset per test so parallel files
  // don't collide.
  let base = 47000 + Math.floor(Math.random() * 500) * 4

  function rangeAllocator() {
    const from = (base += 4)
    return {
      from,
      ports: new PortAllocator(() => ({
        host: "127.0.0.1",
        ports: range(from),
      })),
    }
  }

  it("takes exposed ports from the range, lowest free first", async () => {
    const { from, ports } = rangeAllocator()
    expect(await ports.allocate("a:proxy", { exposed: true })).toBe(from)
    expect(await ports.allocate("b:proxy", { exposed: true })).toBe(from + 1)
  })

  it("reuses a released port before taking a new one", async () => {
    const { from, ports } = rangeAllocator()
    await ports.allocate("a:proxy", { exposed: true })
    await ports.allocate("b:proxy", { exposed: true })
    ports.release("a:proxy")
    expect(await ports.allocate("c:proxy", { exposed: true })).toBe(from)
  })

  it("leaves ports that aren't exposed out of the range", async () => {
    const { from, ports } = rangeAllocator()
    const dev = await ports.allocate("a:dev")
    expect(dev < from || dev > from + 2).toBe(true)
  })

  it("skips a port another key claimed from a previous run", async () => {
    const { from, ports } = rangeAllocator()
    ports.claim("old:proxy", from)
    expect(await ports.allocate("new:proxy", { exposed: true })).toBe(from + 1)
  })

  it("skips a port something else is already listening on", async () => {
    const { from, ports } = rangeAllocator()
    const busy = net.createServer()
    await new Promise<void>((resolve) =>
      busy.listen(from, "127.0.0.1", resolve)
    )
    try {
      expect(await ports.allocate("a:proxy", { exposed: true })).toBe(from + 1)
    } finally {
      await new Promise((resolve) => busy.close(resolve))
    }
  })

  it("gives concurrent allocations distinct ports", async () => {
    const { from, ports } = rangeAllocator()
    const handed = await Promise.all(
      ["a", "b", "c"].map((k) => ports.allocate(k, { exposed: true }))
    )
    expect(handed.sort((a, b) => a - b)).toEqual([from, from + 1, from + 2])
  })

  it("says the range is full when every port is taken", async () => {
    const { ports } = rangeAllocator()
    for (const k of ["a", "b", "c"]) await ports.allocate(k, { exposed: true })
    await expect(ports.allocate("d", { exposed: true })).rejects.toThrow(
      /No free preview port between/
    )
  })
})
