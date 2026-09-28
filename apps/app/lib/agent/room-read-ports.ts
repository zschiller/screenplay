import "server-only"

import sharp from "sharp"

import { loadChatTranscript } from "@/lib/agent/history-load"
import type {
  WorkspaceCheckout,
  WorkspaceReadPorts,
} from "@/lib/agent/room-read-tools"
import { getRoom } from "@/lib/rooms"
import { isSandboxRunning, sandboxProvider } from "@/lib/sandbox"
import type { SandboxInstance } from "@/lib/sandbox"
import { thumbnailCapturer } from "@/lib/thumbnail/capturer"

/**
 * Longest side of a `view_frame` screenshot, in pixels. Big enough to read UI
 * text, and within the size the model takes without downscaling it again.
 */
const MAX_VIEW_DIM = 1280

/** Ceiling on one live capture, as the thumbnail round's per-frame cap. */
const CAPTURE_TIMEOUT_MS = 30_000

/**
 * The Workspace read ports over the live Room: chat transcripts from the
 * durable log, diffs and files from the Workspace's running sandbox (never
 * waking it), and frame screenshots through the Thumbnail Capturer with the
 * Room's stored Frame Captures behind them.
 */
export function liveWorkspaceReadPorts(roomId: string): WorkspaceReadPorts {
  return {
    readChatTranscript: loadChatTranscript,

    async readWorkspaceDiff(checkout, { path }) {
      const sandbox = await runningSandbox(checkout)
      const diff = await sandbox.runCommand("git", [
        "diff",
        `origin/${checkout.defaultBranch}`,
        ...(path ? ["--", path] : []),
      ])
      if (diff.exitCode !== 0) {
        throw new Error((await diff.stderr()).trim() || "git diff failed")
      }
      // `git diff` leaves out files git doesn't track yet; name them.
      const untracked = await sandbox.runCommand("git", [
        "ls-files",
        "--others",
        "--exclude-standard",
        ...(path ? ["--", path] : []),
      ])
      const files = (await untracked.stdout()).trim()
      return [await diff.stdout(), files && `Untracked files:\n${files}`]
        .filter(Boolean)
        .join("\n")
    },

    async readWorkspaceFile(checkout, path) {
      const sandbox = await runningSandbox(checkout)
      const buf = await sandbox.readFileToBuffer({ path })
      if (!buf) return null
      if (buf.includes(0)) return `(binary file, ${buf.length} bytes)`
      return buf.toString("utf-8")
    },

    async captureFrame({ url, width, height }) {
      const png = await withTimeout(
        thumbnailCapturer.capture(url, { width, height }),
        CAPTURE_TIMEOUT_MS
      )
      const scale = Math.min(1, MAX_VIEW_DIM / Math.max(width, height))
      const data = await sharp(png)
        .resize(Math.round(width * scale), Math.round(height * scale), {
          fit: "cover",
        })
        .webp({ quality: 85 })
        .toBuffer()
      return { data, mediaType: "image/webp" }
    },

    async readFrameCapture(frameId) {
      const room = await getRoom(roomId)
      const capture = room?.thumbnailManifest?.frames.find(
        (f) => f.id === frameId
      )?.capture
      if (!capture) return null
      const res = await fetch(capture.url)
      if (!res.ok) return null
      return {
        data: Buffer.from(await res.arrayBuffer()),
        mediaType: res.headers.get("content-type") || "image/webp",
        capturedAt: capture.capturedAt,
      }
    },
  }
}

/** The Workspace's sandbox, only when it's already running. */
async function runningSandbox(
  checkout: WorkspaceCheckout
): Promise<SandboxInstance> {
  const sandbox = await sandboxProvider.get({
    name: checkout.sandboxName,
    resume: false,
  })
  if (!isSandboxRunning(sandbox)) {
    throw new Error("its sandbox isn't running")
  }
  return sandbox
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}
