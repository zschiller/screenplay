import "server-only"

import { nanoid } from "nanoid"

import { kv } from "@/lib/kv"
import { kvCanvasRepoEnvStore, loadCanvasRepoEnv } from "@/lib/repo-env/store"
import { crawlRoutes } from "@/lib/sandbox/inspect"
import {
  provisionSandbox,
  type ProvisionMode,
} from "@/lib/sandbox/provisioning"
import type { RoomDoc } from "@/lib/room-access"
import type { BranchData } from "@/lib/types"

/**
 * One Branch's provisioning, as `/api/branch/create` runs it and the
 * Coordinator's `create_workspaces` (#898) runs it after plan review: the same
 * lock, the same Sandbox Provider call and the same status mirroring onto the
 * Branch record, so a Workspace from either path fails and retries alike.
 */
export interface BranchProvisionRequest {
  flow: NonNullable<BranchData["createFlow"]>
  branchId: string
  sandboxName: string
  branch: string
  repoId: string
  sourceBranch?: string
  /**
   * Whether to create the Branch's first chat once it's provisioned. The
   * branch-create flows set this false when the chat (or a terminal) was
   * seeded at create time. Defaults to true.
   */
  seedChat?: boolean
  /**
   * Re-run a failed create (the sidebar's Retry, #791). Same flow and names as
   * the first attempt; provisioning frees any Sandbox the failed attempt left
   * under this name and accepts a git branch that attempt already created.
   */
  retry?: boolean
}

export interface BranchProvisionOptions {
  ghToken: string | undefined
  /** Runs the provisioning after the caller returns (`after()` in routes). */
  runAfter(task: () => Promise<void>): void
  /** Called once the Branch is running, e.g. to send its seed message. */
  onRunning?(branchId: string): Promise<void>
}

const MODES: Record<BranchProvisionRequest["flow"], ProvisionMode> = {
  new: "new",
  "from-branch": "from-branch",
  "duplicate-branch": "duplicate",
}

/**
 * Take the Branch's create lock and schedule its provisioning. Returns false
 * when another request already holds the lock (a reload or a second member),
 * which then does the work. Failures land on the Branch record as `error`,
 * which is what the sidebar's Retry and the Coordinator's task row show.
 */
export async function startBranchProvisioning(
  room: RoomDoc,
  req: BranchProvisionRequest,
  opts: BranchProvisionOptions
): Promise<boolean> {
  const lock = await kv.acquireLock(`branch-create:${req.branchId}`, 300)
  if (!lock) return false

  opts.runAfter(async () => {
    try {
      const repo = await room.readDoc(({ repos }) => repos.get(req.repoId))
      if (!repo) {
        await markBranchError(room, req.branchId, "Repository not found")
        return
      }
      const result = await provisionSandbox({
        mode: MODES[req.flow],
        repo,
        branch: req.branch,
        sandboxName: req.sandboxName,
        sourceBranch: req.sourceBranch,
        retry: req.retry,
        ghToken: opts.ghToken,
        // Read here on the server, so any member can start a Workspace with
        // values only the Repo's adder can see (#1416).
        envVars: await loadCanvasRepoEnv(
          kvCanvasRepoEnvStore,
          room.roomId,
          repo
        ),
        onStatus: (statusMessage) =>
          updateBranch(room, req.branchId, { statusMessage }),
      })
      if (!result.success) {
        await markBranchError(room, req.branchId, result.error)
        return
      }
      const { sandboxName, previewDomain } = result.value

      await updateBranch(room, req.branchId, {
        previewDomain,
        status: "running",
        statusMessage: undefined,
        error: undefined,
      })
      if (req.seedChat !== false) await ensureChatForBranch(room, req.branchId)
      await opts.onRunning?.(req.branchId)

      // Best-effort: crawl routes so the iframeLayer route picker has options
      // without the user (or model) needing to trigger discovery.
      crawlRoutes(sandboxName)
        .then((crawled) => {
          if (crawled.success) {
            return updateBranch(room, req.branchId, {
              discoveredRoutes: crawled.value,
            })
          }
        })
        .catch(() => {})
    } catch (e) {
      await markBranchError(
        room,
        req.branchId,
        e instanceof Error ? e.message : "Couldn't set up the workspace."
      ).catch(() => {})
    } finally {
      await lock.release().catch(() => {})
    }
  })
  return true
}

/**
 * Mark the Branch failed. The status message is left as it was: it names the
 * step that was running, which titles the sidebar's failure card.
 */
export function markBranchError(
  room: RoomDoc,
  branchId: string,
  error?: string
): Promise<void> {
  return updateBranch(room, branchId, {
    status: "error",
    error: error || "Couldn't set up the workspace.",
  })
}

async function updateBranch(
  room: RoomDoc,
  branchId: string,
  data: Partial<BranchData>
): Promise<void> {
  await room.mutateDoc(({ branches }) => {
    branches.update(branchId, data)
  })
}

/**
 * Ensure a chat session exists for the branch. Frames are pre-created at
 * branch-creation time; doing layout here raced across parallel pipelines
 * because each `mutateDoc` call is a snapshot-then-write rather than a
 * serialized transaction. Chats stay server-created for single-branch flows
 * that don't pre-seed them.
 */
async function ensureChatForBranch(
  room: RoomDoc,
  branchId: string
): Promise<void> {
  await room.mutateDoc(({ branches, chatSessions, transact }) => {
    if (!branches.get(branchId)) return
    transact(() => {
      const hasChat = chatSessions
        .toArray()
        .some((cs) => cs.branchId === branchId)
      if (!hasChat) {
        const chatId = nanoid()
        chatSessions.set(chatId, {
          id: chatId,
          branchId,
          label: "Untitled",
          createdAt: Date.now(),
        })
      }
    })
  })
}
