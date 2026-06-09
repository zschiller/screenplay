import "server-only"

import net from "node:net"

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
 */
export class PortAllocator {
  /** key (e.g. `${sandboxName}:${logicalPort}`) → assigned host port. */
  private readonly assigned = new Map<string, number>()
  /** Every port currently handed out, so we never double-assign one. */
  private readonly inUse = new Set<number>()

  /**
   * Return the host port assigned to `key`, allocating a fresh distinct one on
   * first call. Idempotent — a key keeps its port until {@link release}.
   */
  async allocate(key: string): Promise<number> {
    const existing = this.assigned.get(key)
    if (existing !== undefined) return existing

    const port = await this.findFreePort()
    this.assigned.set(key, port)
    this.inUse.add(port)
    return port
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
  private async findFreePort(): Promise<number> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const port = await ephemeralPort()
      if (!this.inUse.has(port)) return port
    }
    throw new Error(
      "PortAllocator: exhausted attempts finding a free localhost port"
    )
  }
}

/**
 * Bind a listener to `127.0.0.1:0`, read the kernel-assigned port, and close it.
 * The listener is `unref`'d so it can never keep the process alive if a close
 * callback is somehow missed.
 */
function ephemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
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
