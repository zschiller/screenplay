import "server-only"

import { liveFrameReadPorts } from "@/lib/agent/frame-read-ports"
import { loadChatTranscript } from "@/lib/agent/history-load"
import type {
  WorkspaceCheckout,
  WorkspaceReadPorts,
} from "@/lib/agent/room-read-tools"
import { isSandboxRunning, sandboxProvider } from "@/lib/sandbox"
import type { SandboxInstance } from "@/lib/sandbox"

/**
 * The Workspace read ports over the live Room: chat transcripts from the
 * durable log, diffs and files from the Workspace's running sandbox (never
 * waking it), and the frame reads of `frame-read-ports.ts`.
 */
export function liveWorkspaceReadPorts(roomId: string): WorkspaceReadPorts {
  return {
    ...liveFrameReadPorts(roomId),
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
    throw new Error("its sandbox isn’t running")
  }
  return sandbox
}
