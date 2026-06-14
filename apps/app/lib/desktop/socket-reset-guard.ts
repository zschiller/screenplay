import "server-only"

/**
 * Stop a benign socket reset from crashing the whole sidecar process.
 *
 * The thumbnail capturer loads a frame's preview URL — served by *this* same
 * local Next server — in headless Chromium, then tears the browser down in its
 * `finally` when a capture times out (`lib/thumbnail/capturer/puppeteer.ts`).
 * Closing the browser mid-navigation resets that in-flight HTTP connection, and
 * Node surfaces it as an `Error: aborted` with `code: 'ECONNRESET'` on the
 * server side. The same shape arrives when the editor's `keepalive` thumbnail
 * heartbeat POST is aborted on navigate. These are not application errors — the
 * stack is entirely node-internal — but with no handler Node treats them as a
 * fatal `uncaughtException` and takes the sidecar down with it (the Yjs host,
 * the terminal server, and the DB all die together).
 *
 * Default Node behaviour — crash on a connection reset nobody could have
 * awaited — is the bug. This guard swallows *only* that shape (logs a warning)
 * and preserves crash-on-real-bug for everything else by re-raising it: an
 * uncaught error that isn't a socket reset still exits the process with its
 * original stack, exactly as before. Idempotent; install once at boot.
 */
let installed = false

function isSocketReset(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { code?: unknown }).code === "ECONNRESET"
  )
}

export function installSocketResetGuard(): void {
  if (installed) return
  installed = true

  process.on("uncaughtException", (err) => {
    if (isSocketReset(err)) {
      console.warn("[sidecar] ignoring benign socket reset", err)
      return
    }
    // Not ours to swallow: restore the default fatal behaviour. Re-raising on a
    // fresh tick escapes this handler so the process exits with the real error.
    console.error("[sidecar] uncaught exception", err)
    setTimeout(() => {
      throw err
    }, 0)
  })

  process.on("unhandledRejection", (reason) => {
    if (isSocketReset(reason)) {
      console.warn("[sidecar] ignoring benign socket reset (rejection)", reason)
      return
    }
    throw reason
  })
}
