import "server-only"

import { runPrWatchTick } from "./run"

/** How often the desktop server looks at canvases with an open PR: the same
 *  minute the browser's poll uses. */
const INTERVAL_MS = 60_000

let started = false

/**
 * The desktop build's PR Watch tick (#1702): one look at every canvas with an
 * open PR each minute, for as long as the server runs. Each tick waits for the
 * last to finish, so a slow GitHub never stacks them up. Idempotent.
 */
export function startPrWatchInterval(): void {
  if (started) return
  started = true
  const tick = async () => {
    try {
      await runPrWatchTick()
    } catch (e) {
      console.error("PR Watch tick failed:", e)
    }
    setTimeout(tick, INTERVAL_MS).unref()
  }
  setTimeout(tick, INTERVAL_MS).unref()
}
