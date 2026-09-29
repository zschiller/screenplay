import "server-only"

import type { DevServerPorts } from "@/lib/agent/dev-server-tools"
import type { RoomReader } from "@/lib/room-access"
import type { RepoData } from "@/lib/types"

/** How long `restart_dev_server` waits for the new server to answer. */
const ANSWER_TIMEOUT_MS = 30_000
const ANSWER_POLL_MS = 2_000
/** Enough log for any `lines` a tool call asks for, filtered or not. */
const LOG_READ_LINES = 5_000

/**
 * The live {@link DevServerPorts} for one Workspace's Sandbox: the same dev
 * server, log file and Dev Server Restart the Logs panel and the Workspace
 * menu use. The Repo (dev script and port) is read from the Room on each call,
 * so an edit in Canvas settings is picked up by the next restart.
 *
 * The sandbox modules are imported lazily so the toolsets that include these
 * tools don't drag the provisioning graph into every importer.
 */
export function liveDevServerPorts(opts: {
  sandboxName: string
  room: RoomReader
}): DevServerPorts {
  const { sandboxName, room } = opts

  const findRepo = async (): Promise<RepoData> => {
    const repo = await room.readDoc(({ branches, repos }) => {
      const branch = branches
        .toArray()
        .find((b) => b.sandboxName === sandboxName)
      return branch ? repos.get(branch.repoId) : undefined
    })
    if (!repo) throw new Error("this Workspace's repository wasn't found")
    return repo
  }

  const previewUrl = async (): Promise<string | null> => {
    const [{ isSandboxRunning, sandboxProvider }, { PROXY_PORT_OFFSET }] =
      await Promise.all([
        import("@/lib/sandbox"),
        import("@/lib/sandbox/provision-internals"),
      ])
    const [repo, sandbox] = await Promise.all([
      findRepo(),
      sandboxProvider.get({ name: sandboxName, resume: false }),
    ])
    if (!isSandboxRunning(sandbox)) return null
    return sandbox.domain(repo.devServerPort + PROXY_PORT_OFFSET)
  }

  return {
    async status() {
      const [{ isSandboxRunning, sandboxProvider }, { probeSandboxUrl }] =
        await Promise.all([
          import("@/lib/sandbox"),
          import("@/lib/sandbox/lifecycle"),
        ])
      const repo = await findRepo()
      const command = repo.devScript?.trim() || "npm run dev"
      const sandbox = await sandboxProvider
        .get({ name: sandboxName, resume: false })
        .catch(() => null)
      if (!sandbox) {
        return {
          command,
          localUrl: null,
          answering: false,
          unavailable: "the sandbox wasn't found",
        }
      }
      if (!isSandboxRunning(sandbox)) {
        return {
          command,
          localUrl: null,
          answering: false,
          unavailable: "the sandbox is stopped",
        }
      }
      const url = await previewUrl()
      return {
        command,
        localUrl: `http://localhost:${sandbox.hostPort(repo.devServerPort)}`,
        answering: url ? await probeSandboxUrl(url) : false,
      }
    },

    async readLog() {
      const [{ isSandboxRunning, sandboxProvider }, { sandboxLogPath }] =
        await Promise.all([
          import("@/lib/sandbox"),
          import("@/lib/sandbox/provision-internals"),
        ])
      const sandbox = await sandboxProvider
        .get({ name: sandboxName, resume: false })
        .catch(() => null)
      // A hibernated VM can't run `tail`, and reading must never wake it.
      if (!sandbox || !isSandboxRunning(sandbox)) return ""
      const result = await sandbox.runCommand("tail", [
        "-n",
        String(LOG_READ_LINES),
        sandboxLogPath(sandbox.name),
      ])
      // A missing log (the server never launched) reads as empty.
      return result.exitCode === 0 ? await result.stdout() : ""
    },

    async restart() {
      const { restartDevServer } = await import("@/lib/sandbox/lifecycle")
      try {
        const result = await restartDevServer(sandboxName, await findRepo())
        return result.success
          ? { ok: true }
          : { ok: false, error: result.error || "unknown error" }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },

    async waitUntilAnswering() {
      const { probeSandboxUrl } = await import("@/lib/sandbox/lifecycle")
      const url = await previewUrl().catch(() => null)
      if (!url) return false
      const deadline = Date.now() + ANSWER_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (await probeSandboxUrl(url)) return true
        await new Promise((resolve) => setTimeout(resolve, ANSWER_POLL_MS))
      }
      return false
    },
  }
}
