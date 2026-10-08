// Sharing on and off (#1953, spec #1921): the Mac app's owner turns Sharing
// on to open the viewer listener and serve it over the preview exposure, and
// off to close it and release every exposure it made. Off is the default.
//
// The viewer listener binds 127.0.0.1 on a port kept in the sharing file, so
// a canvas's link stays the same across launches; the preview exposure
// (Tailscale in the Mac app) gives it the origin viewers load. Previews a
// viewer's frame asks for are exposed through here too, so turning Sharing
// off can release each one, even after a restart.
//
// Plain Node, no TS: the front server owns it, outside the app's bundles; the
// app reaches the one this process runs through `getSharing()`.

import { readFile, rename, writeFile } from "node:fs/promises"
import net from "node:net"

/**
 * @typedef {import("@/lib/preview-exposure/types").PreviewExposure} PreviewExposure
 * @typedef {{ name: string, address: string, port: number }} ViewerListener
 * @typedef {{ on: boolean, port?: number, exposed: number[] }} SharingFile
 * @typedef {{
 *   on: boolean
 *   origin: string | null
 *   error: string | null
 * }} SharingState
 * @typedef {{
 *   close: () => Promise<void>
 * }} OpenListener
 */

/**
 * The Sharing switch for one server.
 *
 * @param {{
 *   open: (listener: ViewerListener) => Promise<OpenListener>
 *   exposure: () => PreviewExposure | undefined
 *   closeViewerSockets?: () => Promise<void>
 *   file?: string
 *   freePort?: () => Promise<number>
 *   log?: (line: string) => void
 * }} opts
 */
export function createSharing({
  open,
  exposure,
  closeViewerSockets = async () => {},
  file,
  freePort = pickFreePort,
  log = (line) => console.warn(line),
}) {
  /** @type {SharingFile} */
  let saved = { on: false, exposed: [] }
  /** @type {OpenListener | null} */
  let listening = null
  /** @type {SharingState} */
  let state = { on: false, origin: null, error: null }
  /** One change at a time, in order. */
  let queue = Promise.resolve()

  const serial = (fn) => {
    const next = queue.then(fn)
    queue = next.then(
      () => {},
      () => {}
    )
    return next
  }

  async function save() {
    if (!file) return
    const tmp = `${file}.tmp`
    await writeFile(tmp, `${JSON.stringify(saved)}\n`)
    await rename(tmp, file)
  }

  function current() {
    const found = exposure()
    if (!found) throw new Error("Sharing isn’t available in this build.")
    return found
  }

  async function turnOn() {
    if (listening) return state
    saved.port ??= await freePort()
    const listener = { name: "tailnet", address: "127.0.0.1", port: saved.port }
    try {
      listening = await open(listener)
    } catch (err) {
      return fail(`The viewer listener couldn’t start: ${describe(err)}`)
    }
    let origin
    try {
      origin = (await current().expose(listener.port)).browserOrigin
    } catch (err) {
      await closeListener()
      return fail(describe(err))
    }
    saved.on = true
    await save()
    state = { on: true, origin, error: null }
    return state
  }

  async function fail(error) {
    saved.on = false
    await save().catch(() => {})
    state = { on: false, origin: null, error }
    return state
  }

  async function closeListener() {
    const was = listening
    listening = null
    await closeViewerSockets()
    await was?.close()
  }

  async function turnOff() {
    await closeListener()
    const found = exposure()
    if (found) {
      const ports = [...new Set([...saved.exposed, saved.port ?? 0])].filter(
        (p) => p > 0
      )
      await Promise.all(ports.map((port) => found.release(port)))
    }
    saved = { on: false, port: saved.port, exposed: [] }
    await save()
    state = { on: false, origin: null, error: null }
    return state
  }

  return {
    /**
     * Read the sharing file, then turn Sharing back on if it was on, or
     * release what an earlier run left exposed if it was off.
     */
    start: () =>
      serial(async () => {
        if (file) {
          try {
            const raw = JSON.parse(await readFile(file, "utf8"))
            saved = {
              on: raw?.on === true,
              port: Number.isInteger(raw?.port) ? raw.port : undefined,
              exposed: Array.isArray(raw?.exposed)
                ? raw.exposed.filter(Number.isInteger)
                : [],
            }
          } catch (err) {
            if (err?.code !== "ENOENT") {
              log(`[sharing] couldn’t read ${file}: ${describe(err)}`)
            }
          }
        }
        if (saved.on) return turnOn()
        if (saved.exposed.length) return turnOff()
        return state
      }),
    /** Whether Sharing is on, where viewers load it, and why it last failed. */
    state: () => state,
    /** Turn Sharing on or off. Resolves with the new state; never throws. */
    set: (on) =>
      serial(() => (on ? turnOn() : turnOff())).catch((err) =>
        fail(describe(err))
      ),
    /**
     * Expose a preview port for a viewer's frame, remembering it so turning
     * Sharing off releases it. Refused while Sharing is off.
     *
     * @param {number} port
     */
    expose: (port) =>
      serial(async () => {
        if (!state.on) throw new Error("Sharing is off.")
        const exposed = await current().expose(port)
        if (!saved.exposed.includes(port)) {
          saved.exposed.push(port)
          await save()
        }
        return exposed
      }),
    /**
     * Release a preview port whose listener went away (its chat was
     * deleted), if Sharing exposed it.
     *
     * @param {number} port
     */
    release: (port) =>
      serial(async () => {
        if (!saved.exposed.includes(port)) return
        await exposure()?.release(port)
        saved.exposed = saved.exposed.filter((p) => p !== port)
        await save()
      }),
  }
}

/** @typedef {ReturnType<typeof createSharing>} Sharing */

const SHARING = Symbol.for("screenplay.sharing")
const EXPOSURE = Symbol.for("screenplay.sharingExposure")

/** Hand the front server's Sharing to the app (the front server, as it starts). */
export function setSharing(sharing) {
  globalThis[SHARING] = sharing
}

/**
 * This server's Sharing, or undefined where nothing serves viewers: Hosted,
 * Headless, and `next dev`, which runs without the front server.
 *
 * @returns {Sharing | undefined}
 */
export function getSharing() {
  return globalThis[SHARING]
}

/** Hand the front server the preview exposure Sharing serves through (`instrumentation.ts`). */
export function setSharingExposure(exposure) {
  globalThis[EXPOSURE] = exposure
}

/** @returns {PreviewExposure | undefined} */
export function sharingExposure() {
  return globalThis[EXPOSURE]
}

/** An OS-assigned free port on 127.0.0.1, for the first time Sharing turns on. */
export function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (
        server.address()
      )
      server.close(() => resolve(port))
    })
  })
}

function describe(err) {
  return err instanceof Error ? err.message : String(err)
}
