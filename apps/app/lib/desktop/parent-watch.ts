import "server-only"

/**
 * The env var the Tauri desktop shell sets to its own PID when it spawns the
 * sidecar (issue #418). Its presence selects this behavior; the value is the
 * process to watch. Unset on the hosted build, so this is a desktop-only path.
 */
export const SHELL_PID_ENV_VAR = "SCREENPLAY_SHELL_PID"

/**
 * Exit the sidecar when the desktop shell that spawned it goes away.
 *
 * Tauri's clean-quit handler kills the sidecar directly, but a **force-kill or
 * crash of the shell skips that** — the sidecar is reparented to launchd and
 * lives on, holding the local Yjs port and, worse, the PGlite data dir. The next
 * launch then opens that same dir concurrently and PGlite aborts mid-migrate
 * (`RuntimeError: Aborted()`), bricking restarts. So the sidecar watches its
 * shell and exits the moment it's gone, releasing both.
 *
 * `process.kill(pid, 0)` sends no signal — it only probes liveness, throwing
 * when the shell is gone. The interval is `unref`'d so it never itself keeps the
 * process alive. No-op on the hosted build (the var is unset).
 *
 * @returns the interval handle (for tests), or `undefined` when not watching.
 */
export function watchParentShell(
  env: Record<string, string | undefined> = process.env,
  deps: {
    isAlive?: (pid: number) => boolean
    exit?: (code: number) => void
    intervalMs?: number
  } = {}
): NodeJS.Timeout | undefined {
  const pid = Number(env[SHELL_PID_ENV_VAR])
  // launchd is pid 1; a sidecar already reparented there has no shell to watch.
  if (!Number.isInteger(pid) || pid <= 1) return undefined

  const isAlive =
    deps.isAlive ??
    ((p: number) => {
      try {
        process.kill(p, 0)
        return true
      } catch {
        return false
      }
    })
  const exit = deps.exit ?? ((code: number) => process.exit(code))

  const timer = setInterval(() => {
    if (!isAlive(pid)) {
      console.error(
        `[sidecar] desktop shell (pid ${pid}) is gone — exiting to release the data dir and ports`
      )
      exit(0)
    }
  }, deps.intervalMs ?? 1000)
  timer.unref()
  return timer
}
