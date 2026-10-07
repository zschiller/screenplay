import "server-only"

import net from "node:net"

import type { PortRange } from "@/lib/preview-exposure/types"

/** Where a browser-facing port binds, and the range it's taken from. */
export type PortBind = { host: string; ports?: PortRange }

const LOOPBACK = "127.0.0.1"

/**
 * Hands out distinct localhost ports — one assignment per key — and reclaims
 * them on release. The worktree {@link SandboxProvider} uses it to keep every
 * Branch's dev server (and its derived proxy / terminal ports) on a port no
 * other Branch is using, so two local previews never collide the way they would
 * if each `npm run dev` grabbed the default 3000.
 *
 * Ports are sourced with the OS ephemeral-port technique validated by spike
 * #407: bind a throwaway listener to `127.0.0.1:0`, read the port the kernel
 * assigned, drop the listener, hand the number out. There is a small TOCTOU
 * window between dropping that listener and the real consumer binding the port,
 * so an "allocated" port is *not* a reservation — a consumer that loses the race
 * should re-roll on `EADDRINUSE`. Within this process we additionally never hand
 * the same port to two live keys: the kernel can re-offer a just-freed port, so
 * we re-roll until we get one not already in {@link inUse}.
 *
 * Assignment is idempotent: allocating the same key twice returns the same port
 * (so re-resolving a Branch's Sandbox is stable), and only `release` frees it.
 *
 * A port a browser loads (`exposed`) follows the preview exposure's `bind`
 * instead: it must be free on `bind.host`, and with a `bind.ports` range it is
 * the lowest free port in it, so a freed port is the next one handed out. A
 * company proxy needs one sign-in per port, so reusing ports keeps that a
 * one-time cost.
 */
export class PortAllocator {
  /** key (e.g. `${sandboxName}:${logicalPort}`) → assigned host port. */
  private readonly assigned = new Map<string, number>()
  /** Every port currently handed out, so we never double-assign one. */
  private readonly inUse = new Set<number>()

  /** Where exposed ports bind and which they may take, read per allocation. */
  private readonly bind: () => PortBind

  constructor(bind: () => PortBind = () => ({ host: LOOPBACK })) {
    this.bind = bind
  }

  /**
   * Return the host port assigned to `key`, allocating a fresh distinct one on
   * first call. Idempotent — a key keeps its port until {@link release}.
   * `exposed` marks a port a browser loads (see the class comment).
   */
  async allocate(
    key: string,
    { exposed = false }: { exposed?: boolean } = {}
  ): Promise<number> {
    const existing = this.assigned.get(key)
    if (existing !== undefined) return existing

    const bind: PortBind = exposed ? this.bind() : { host: LOOPBACK }
    const port = bind.ports
      ? await this.findFreeInRange(bind.host, bind.ports)
      : await this.findFreePort(bind.host)
    // Re-check: another allocation for the same key may have finished first.
    const raced = this.assigned.get(key)
    if (raced !== undefined) {
      if (bind.ports) this.inUse.delete(port)
      return raced
    }
    this.assigned.set(key, port)
    this.inUse.add(port)
    return port
  }

  /**
   * Record a port `key` already holds (one a previous run of the server
   * allocated and persisted), so it's never handed to another key.
   */
  claim(key: string, port: number): void {
    if (this.assigned.has(key)) return
    this.assigned.set(key, port)
    this.inUse.add(port)
  }

  /** The port assigned to `key`, or `undefined` if it has none. */
  get(key: string): number | undefined {
    return this.assigned.get(key)
  }

  /**
   * Reclaim `key`'s port so it can be handed out again. No-op for an unknown
   * key, so a double-release (e.g. delete racing a cleanup) is harmless.
   */
  release(key: string): void {
    const port = this.assigned.get(key)
    if (port === undefined) return
    this.assigned.delete(key)
    this.inUse.delete(port)
  }

  /**
   * Ask the OS for an ephemeral port, re-rolling if it hands back one we've
   * already assigned (a just-freed port can be re-offered). Bounded so a
   * pathological run can't spin forever.
   */
  private async findFreePort(host: string): Promise<number> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const port = await ephemeralPort(host)
      if (!this.inUse.has(port)) return port
    }
    throw new Error(
      "PortAllocator: exhausted attempts finding a free localhost port"
    )
  }

  /**
   * The lowest port in `range` that no key holds and that binds on `host`.
   * Each candidate is reserved before the bind check, so concurrent
   * allocations never settle on the same port.
   */
  private async findFreeInRange(
    host: string,
    range: PortRange
  ): Promise<number> {
    for (let port = range.from; port <= range.to; port++) {
      if (this.inUse.has(port)) continue
      this.inUse.add(port)
      if (await canBind(host, port)) return port
      this.inUse.delete(port)
    }
    throw new Error(
      `No free preview port between ${range.from} and ${range.to}. ` +
        "Delete a chat, or widen the preview port range."
    )
  }
}

/**
 * Bind a listener to `host:0`, read the kernel-assigned port, and close it.
 * The listener is `unref`'d so it can never keep the process alive if a close
 * callback is somehow missed.
 */
function ephemeralPort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once("error", reject)
    server.listen(0, host, () => {
      const address = server.address()
      const port =
        address && typeof address === "object" ? address.port : undefined
      if (port === undefined) {
        server.close()
        reject(new Error("PortAllocator: listener returned no port"))
        return
      }
      server.close(() => resolve(port))
    })
  })
}

/** Whether `host:port` is free to listen on right now. */
function canBind(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once("error", () => resolve(false))
    server.listen(port, host, () => server.close(() => resolve(true)))
  })
}
