import "server-only"

import { createHash } from "node:crypto"
import { frameStreamKey } from "@/lib/frame-stream/token"
import {
  PROXY_PORT_OFFSET,
  STREAM_PORT,
  previewListenEnv,
  sandboxStateDir,
  sessionLeader,
} from "@/lib/sandbox/provision-internals"
import { runSandboxAction, step } from "@/lib/sandbox/run"
import type { SandboxActionResult } from "@/lib/sandbox/run"
import type { SandboxInstance } from "@/lib/sandbox/types"

const SCRIPT_PATH = "/tmp/screenplay/frame-stream.mjs"
const pidPath = (name: string) => `${sandboxStateDir(name)}/frame-stream.pid`
// What the running service was launched with: the script's hash and the
// frame origin. A difference relaunches it (each frame then reloads its URL).
const stampPath = (name: string) =>
  `${sandboxStateDir(name)}/frame-stream.stamp`
const logPath = (name: string) => `${sandboxStateDir(name)}/frame-stream.log`

// The Workspace image's browser (#1388).
const CHROME = "google-chrome"

export { sharedFramesEnabled } from "@/lib/frame-stream/shared-frames"

/**
 * The stream's WebSocket URL for the server's own connection, or null when
 * the Sandbox doesn't forward the stream port (it was created before shared
 * frames).
 */
function internalStreamUrl(sandbox: SandboxInstance): string | null {
  try {
    return toWs(sandbox.internalUrl(STREAM_PORT))
  } catch {
    return null
  }
}

const toWs = (url: string) => url.replace(/^http/, "ws")

export type FrameStreamEndpoint = {
  /** Where a browser connects. */
  url: string
  /** Where the server connects (frame drive); never a browser URL. */
  internalUrl: string
}

/**
 * Ensure the Workspace's Frame Stream service (#1392) is running, then return
 * the URL viewers connect to. Idempotent: a live service launched from this
 * script for this dev port is reused. After a hibernation or the Sandbox's
 * 24-hour cap the service is gone, and the first viewer back launches it
 * again; each frame then reloads at the room's route as viewers watch it.
 *
 * Resolves to `null` when the Sandbox has no stream port, so the canvas keeps
 * per-viewer frames for it.
 */
export async function ensureFrameStream(
  sandboxName: string,
  devPort: number
): Promise<SandboxActionResult<FrameStreamEndpoint | null>> {
  return runSandboxAction(sandboxName, async (sandbox) => {
    const internalUrl = internalStreamUrl(sandbox)
    if (!internalUrl) return null
    const { FRAME_STREAM_JS } = await import("@/lib/sandbox-bridge")
    const origin = `http://127.0.0.1:${sandbox.hostPort(devPort + PROXY_PORT_OFFSET)}`
    const listen = previewListenEnv("SCREENPLAY_STREAM_HOST")
    const stamp = createHash("sha256")
      .update(FRAME_STREAM_JS)
      .update(origin)
      .update(JSON.stringify(listen))
      .digest("hex")
      .slice(0, 16)
    if (!(await isRunning(sandbox, stamp))) {
      await sandbox.writeFiles([
        { path: SCRIPT_PATH, content: FRAME_STREAM_JS },
      ])
      await launch(sandbox, origin, stamp, listen)
    }
    const { browserOrigin } = await sandbox.expose(STREAM_PORT)
    return { url: toWs(browserOrigin), internalUrl }
  })
}

/** True when the pidfile names a live process launched with `stamp`. */
async function isRunning(
  sandbox: SandboxInstance,
  stamp: string
): Promise<boolean> {
  const probe = await step(sandbox, "sh", [
    "-c",
    `[ "$(cat ${stampPath(sandbox.name)} 2>/dev/null)" = "${stamp}" ] && ` +
      `kill -0 "$(cat ${pidPath(sandbox.name)} 2>/dev/null)" 2>/dev/null && ` +
      `echo running || echo stopped`,
  ])
  return (await probe.stdout()).trim() === "running"
}

/**
 * Start the service as its own process group (stopping one left by an older
 * launch first), on the forwarded stream port, with this Workspace's stream
 * key. Like the terminal daemon, it logs to its own file, not the Logs panel.
 */
async function launch(
  sandbox: SandboxInstance,
  origin: string,
  stamp: string,
  listen: Record<string, string>
): Promise<void> {
  const name = sandbox.name
  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `mkdir -p ${sandboxStateDir(name)}; ` +
        `p=$(cat ${pidPath(name)} 2>/dev/null); ` +
        `[ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null && { kill -TERM "-$p" 2>/dev/null; sleep 0.5; kill -KILL "-$p" 2>/dev/null; }; ` +
        `${sessionLeader()} node ${SCRIPT_PATH} </dev/null >> ${logPath(name)} 2>&1 & ` +
        `echo $! > ${pidPath(name)}; ` +
        `echo ${stamp} > ${stampPath(name)}; ` +
        `disown`,
    ],
    detached: true,
    env: {
      SCREENPLAY_STREAM_PORT: String(sandbox.hostPort(STREAM_PORT)),
      SCREENPLAY_STREAM_KEY: frameStreamKey(name),
      SCREENPLAY_FRAME_ORIGIN: origin,
      SCREENPLAY_CHROME: CHROME,
      // Loopback on the local backend; a hosted VM keeps every interface.
      ...listen,
    },
  })
  // Answer once it listens, so the first viewer doesn't race it.
  await step(sandbox, "sh", [
    "-c",
    `for i in $(seq 1 50); do curl -fs http://127.0.0.1:${sandbox.hostPort(STREAM_PORT)}/health >/dev/null && exit 0; sleep 0.1; done; ` +
      `echo "the frame stream didn’t start" >&2; tail -n 20 ${logPath(name)} >&2; exit 1`,
  ])
}
