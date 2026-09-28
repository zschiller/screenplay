import { NextResponse, after } from "next/server"
import { getGitHubToken, getUserId } from "@/lib/auth-helpers"
import { isLocalBuild } from "@/lib/local-mode"
import { nanoid } from "nanoid"
import { kv } from "@/lib/kv"
import { crawlRoutes } from "@/lib/sandbox/inspect"
import {
  provisionSandbox,
  type ProvisionMode,
} from "@/lib/sandbox/provisioning"
import type { BranchData, RepoData } from "@/lib/types"
import { mutateRoomDoc, readRoomDoc } from "@/lib/yjs/server"

export const runtime = "nodejs"
export const maxDuration = 300

interface CreateRequest {
  flow: "new" | "from-branch" | "duplicate-branch"
  roomId: string
  branchId: string
  sandboxName: string
  branch: string
  repoId: string
  sourceBranch?: string
  /**
   * Whether the server should auto-create the branch's first chat once it's
   * provisioned. The branch-create flows set this false because the client now
   * pre-seeds the branch's default tab (chat or terminal) itself, so the tab
   * appears immediately instead of only after provisioning. Defaults to true
   * (the historic behaviour) when absent, for any caller that doesn't pre-seed.
   */
  seedChat?: boolean
  /**
   * Re-run a failed create (the sidebar's Retry, #791). Same flow and names as
   * the first attempt; provisioning frees any Sandbox the failed attempt left
   * under this name and accepts a git branch that attempt already created.
   */
  retry?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function updateBranch(
  roomId: string,
  branchId: string,
  data: Partial<BranchData>
) {
  await mutateRoomDoc(roomId, ({ branches }) => {
    branches.update(branchId, data)
  })
}

async function getRepoFromStorage(
  roomId: string,
  repoId: string
): Promise<RepoData | null> {
  return readRoomDoc(roomId, ({ repos }) => repos.get(repoId) ?? null)
}

/**
 * Ensure a chat session exists for the branch. IframeLayers + groups are
 * pre-created on the client at branch-creation time (see
 * `seedIframeLayerForAgent` in canvas.tsx) — doing layout server-side raced
 * across parallel pipelines because each `mutateRoomDoc` call is a
 * snapshot-then-write rather than a serialized transaction. Chats stay
 * server-created for single-branch flows that don't pre-seed them.
 */
async function ensureChatForBranch(roomId: string, branchId: string) {
  await mutateRoomDoc(roomId, ({ branches, chatSessions, transact }) => {
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

/** Mark the Branch failed. The status message is left as it was: it names the
 *  step that was running, which titles the sidebar's failure card. */
function markError(roomId: string, branchId: string, error?: string) {
  return updateBranch(roomId, branchId, {
    status: "error",
    error: error || "Unknown error",
  })
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

const MODES: Record<CreateRequest["flow"], ProvisionMode> = {
  new: "new",
  "from-branch": "from-branch",
  "duplicate-branch": "duplicate",
}

/**
 * Provision the Branch's Sandbox and mirror the outcome onto the Branch
 * record: each step's progress as its status message, then either the error
 * or the running state + preview domain.
 */
async function provisionBranch(
  req: CreateRequest,
  repo: RepoData,
  ghToken: string | undefined
) {
  const { roomId, branchId } = req
  const result = await provisionSandbox({
    mode: MODES[req.flow],
    repo,
    branch: req.branch,
    sandboxName: req.sandboxName,
    sourceBranch: req.sourceBranch,
    retry: req.retry,
    ghToken,
    onStatus: (statusMessage) =>
      updateBranch(roomId, branchId, { statusMessage }),
  })
  if (!result.success) {
    await markError(roomId, branchId, result.error)
    return
  }
  const { sandboxName, previewDomain } = result.value

  await updateBranch(roomId, branchId, {
    previewDomain,
    status: "running",
    statusMessage: undefined,
    error: undefined,
  })
  // Skipped when the client pre-seeded the branch's default tab — chat or
  // terminal — itself (seedChat === false) so the branch isn't also given an
  // extra auto chat.
  if (req.seedChat !== false) {
    await ensureChatForBranch(roomId, branchId)
  }

  // Best-effort: crawl routes so the iframeLayer route picker has options without
  // the user (or model) needing to trigger discovery.
  crawlRoutes(sandboxName)
    .then((result) => {
      if (result.success) {
        return updateBranch(roomId, branchId, {
          discoveredRoutes: result.value,
        })
      }
    })
    .catch(() => {})
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // The hosted build can't do anything without a token (branches are created
  // via the GitHub API and clones are token-authed). The local build can: git
  // rides host auth and branches are created locally when no token resolves
  // (PRD #428), so a missing token must not block creation there.
  const ghToken = (await getGitHubToken()) ?? undefined
  if (!ghToken && !isLocalBuild) {
    return NextResponse.json(
      { error: "No GitHub token — please re-authenticate with GitHub" },
      { status: 401 }
    )
  }

  const body = (await request.json()) as CreateRequest
  const { roomId, branchId, repoId } = body

  // Distributed lock — prevent duplicate creation (page reload, multiplayer)
  const lock = await kv.acquireLock(`branch-create:${branchId}`, 300)
  if (!lock) {
    // Another instance is already handling this branch's creation
    return NextResponse.json({ ok: true })
  }

  after(async () => {
    try {
      const repo = await getRepoFromStorage(roomId, repoId)
      if (!repo) {
        await markError(roomId, branchId, "Repository not found")
        return
      }

      await provisionBranch(body, repo, ghToken)
    } catch (e) {
      await markError(
        roomId,
        branchId,
        e instanceof Error
          ? e.message
          : "Unexpected error during sandbox creation"
      ).catch(() => {})
    } finally {
      await lock.release().catch(() => {})
    }
  })

  return NextResponse.json({ ok: true })
}
