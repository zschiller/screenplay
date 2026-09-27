import { spawn, type ChildProcess } from "node:child_process"

import { captureEnv, type CaptureProfile } from "../profile"
import { startPreviewServer } from "./preview-server"

/**
 * Booting and reaching the local build for a capture run.
 *
 * The harness deliberately runs the app with `next dev`, not a production build.
 * A capture run is iterative — tweak a style, re-shoot one screen — and a full
 * `next build` per iteration would dominate the loop. The trade-off is the
 * first-hit compile per route, which is why {@link waitForServer} is patient and
 * why the runner warms each screen's route before shooting it.
 */

export interface ServerHandle {
  /** Whether this process started the server (and therefore must stop it). */
  started: boolean
  stop: () => Promise<void>
}

/** Whether something is already serving the profile's port. */
export async function isServerUp(profile: CaptureProfile): Promise<boolean> {
  try {
    const res = await fetch(`${profile.baseUrl}/api/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Spawn `next dev` with the capture profile applied. Returns once the server
 * answers `/api/health`, which is the same readiness gate the Tauri shell waits
 * on before navigating its webview — and it means more than "the port is open":
 * `instrumentation.ts` runs the PGlite migrations and boots the local Yjs host
 * before the first request is served, so a healthy server is one whose fixtures
 * are actually reachable.
 */
export async function startServer(
  profile: CaptureProfile,
  opts: { log?: (message: string) => void; quiet?: boolean } = {}
): Promise<ServerHandle> {
  const log = opts.log ?? ((m: string) => console.log(m))

  if (await isServerUp(profile)) {
    log(`• reusing the server already on ${profile.baseUrl}`)
    return { started: false, stop: async () => {} }
  }

  log(`• starting the local build on ${profile.baseUrl}`)
  const child = spawn(
    "pnpm",
    [
      "exec",
      "next",
      "dev",
      "--turbopack",
      "-p",
      String(profile.port),
      "-H",
      "127.0.0.1",
    ],
    {
      cwd: profile.appRoot,
      env: captureEnv(profile),
      // Own process group, so stopping the harness takes the whole Next process
      // tree (Turbopack's workers included) rather than orphaning children that
      // would keep holding the port and the PGlite data dir.
      detached: true,
      stdio: opts.quiet ? ["ignore", "ignore", "pipe"] : "inherit",
    }
  )

  // Even when quiet, surface stderr — a boot that fails on a missing migration
  // or a held data dir is otherwise a silent timeout.
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk))

  let exited: { code: number | null; signal: NodeJS.Signals | null } | null =
    null
  child.on("exit", (code, signal) => {
    exited = { code, signal }
  })

  const handle: ServerHandle = {
    started: true,
    stop: () => stopServer(child),
  }

  try {
    await waitForServer(profile, () => exited)
  } catch (err) {
    await handle.stop()
    throw err
  }
  log("• server is healthy")
  return handle
}

/**
 * Poll `/api/health` until it answers. The generous ceiling is for the cold
 * Turbopack compile of the first route on a fresh checkout; it fails fast instead
 * if the child has already exited, so a crashed boot reports the crash rather
 * than timing out two minutes later.
 */
export async function waitForServer(
  profile: CaptureProfile,
  exitedProbe: () => {
    code: number | null
    signal: NodeJS.Signals | null
  } | null = () => null,
  timeoutMs = 180_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const exited = exitedProbe()
    if (exited) {
      throw new Error(
        `the app server exited before becoming healthy (code ${exited.code}, signal ${exited.signal})`
      )
    }
    if (await isServerUp(profile)) return
    await sleep(500)
  }
  throw new Error(
    `the app server never answered ${profile.baseUrl}/api/health within ${timeoutMs}ms`
  )
}

/**
 * Stop a spawned server and its whole process group. `SIGTERM` first — the
 * sidecar's exit hooks release the PGlite data-dir lock and reap the local
 * sandbox's detached children on a clean signal — then `SIGKILL` if it lingers,
 * because a survivor holds the port and the next run can't open the database.
 */
async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const done = new Promise<void>((resolve) =>
    child.once("exit", () => resolve())
  )
  killGroup(child, "SIGTERM")
  const settled = await Promise.race([
    done.then(() => true),
    sleep(5000).then(() => false),
  ])
  if (!settled) killGroup(child, "SIGKILL")
  await Promise.race([done, sleep(2000)])
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid == null) return
  try {
    // Negative pid = the process group `detached: true` gave the child.
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      /* already gone */
    }
  }
}

export interface CaptureStack {
  /** True when this process started the app server (and so must stop it). */
  appStarted: boolean
  /** Stop everything this process started, in reverse order. */
  stop: () => Promise<void>
}

/**
 * Bring up everything a capture needs: the fixture preview server (so Iframe
 * Layers have content to load) and the local build itself.
 *
 * Preview first, app second. The canvas probes a frame's preview URL as soon as
 * it mounts and backs off between retries, so a preview server that arrives late
 * costs every frame on the first screen a visible spinner.
 *
 * Both halves reuse whatever is already listening, which is what lets
 * `screenshots:shots` run against a `screenshots:boot` left open in another
 * terminal — and, equally, what stops it from tearing that session down.
 */
export async function startCaptureStack(
  profile: CaptureProfile,
  opts: { log?: (message: string) => void; quiet?: boolean } = {}
): Promise<CaptureStack> {
  const log = opts.log ?? ((m: string) => console.log(m))
  const preview = await startPreviewServer(
    profile.previewOrigin,
    profile.previewPort
  )
  if (preview.started)
    log(`• serving fixture previews on ${profile.previewOrigin}`)

  try {
    const app = await startServer(profile, opts)
    return {
      appStarted: app.started,
      stop: async () => {
        if (app.started) await app.stop()
        if (preview.started) await preview.stop()
      },
    }
  } catch (err) {
    if (preview.started) await preview.stop()
    throw err
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
