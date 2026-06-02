import { NextResponse, after } from "next/server"
import { getGitHubToken, getUserId } from "@/lib/auth-helpers"
import { nanoid } from "nanoid"
import { kv } from "@/lib/kv"
import {
  cloneSandbox,
  installDependencies,
  installHarnesses,
  installRipgrep,
  startDevServer,
} from "@/lib/sandbox/provision"
import { parseHarnessKeys } from "@/lib/agent/harnesses"
import { createAgentBranch, configureAgentGit } from "@/lib/sandbox/git"
import { crawlRoutes } from "@/lib/sandbox/inspect"
import { parseEnvVars } from "@/lib/env-utils"
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
   * provisioned. The client sets this false when the user's default-tab pref is
   * "terminal" — it has already seeded a terminal tab, so the branch should open
   * to that alone rather than also getting a chat. Defaults to true (the
   * historic behaviour) when absent.
   */
  seedChat?: boolean
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

function markError(roomId: string, branchId: string, error?: string) {
  return updateBranch(roomId, branchId, {
    status: "error",
    statusMessage: undefined,
    error: error || "Unknown error",
  })
}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

async function runNewOrFromBranchPipeline(
  req: CreateRequest,
  repo: RepoData,
  ghToken: string
) {
  const { flow, roomId, branchId, sandboxName, branch } = req
  const env = parseEnvVars(repo.envVars)
  const envOrUndefined = Object.keys(env).length > 0 ? env : undefined

  // Step 1: Create branch (skip for from-branch flow)
  if (flow === "new") {
    const branchResult = await createAgentBranch(
      repo,
      branch,
      undefined,
      ghToken
    )
    if (!branchResult.success) {
      await markError(
        roomId,
        branchId,
        branchResult.error || "Failed to create branch"
      )
      return
    }
  }

  // Step 2: Clone repo into sandbox
  await updateBranch(roomId, branchId, { statusMessage: "Cloning repository…" })
  const cloneResult = await cloneSandbox(
    sandboxName,
    repo.cloneUrl,
    branch,
    repo.devServerPort,
    envOrUndefined,
    ghToken
  )
  if (!cloneResult.success) {
    await markError(roomId, branchId, cloneResult.error)
    return
  }
  const clonedSandboxName = cloneResult.value.sandboxName

  // Step 3: Install dependencies + the selected harnesses + ripgrep in parallel.
  // The harness install and ripgrep are best-effort: `installHarnesses` logs and
  // swallows a failed CLI internally (one bad harness can't dark the Sandbox) and
  // ripgrep's result is ignored here, so neither can fail the pipeline. Only the
  // dependency install is load-bearing. Harness keys come from SANDBOX_HARNESSES;
  // unset → none.
  await updateBranch(roomId, branchId, {
    statusMessage: "Installing dependencies…",
  })
  const harnessKeys = parseHarnessKeys(process.env.SANDBOX_HARNESSES)
  const [installResult] = await Promise.all([
    installDependencies(clonedSandboxName, repo.setupScript),
    installHarnesses(clonedSandboxName, harnessKeys),
    installRipgrep(clonedSandboxName),
  ])
  if (!installResult.success) {
    await markError(roomId, branchId, installResult.error)
    return
  }

  // Step 4: Start dev server
  await updateBranch(roomId, branchId, {
    statusMessage: "Starting dev server…",
  })
  const serverResult = await startDevServer(
    clonedSandboxName,
    repo.devServerPort,
    repo.devScript
  )
  if (!serverResult.success) {
    await markError(roomId, branchId, serverResult.error)
    return
  }

  // Step 5: Configure git
  await updateBranch(roomId, branchId, { statusMessage: "Configuring git…" })
  const gitResult = await configureAgentGit(clonedSandboxName, repo, branch)
  if (!gitResult.success) {
    await markError(roomId, branchId, gitResult.error)
    return
  }

  // Done
  await updateBranch(roomId, branchId, {
    previewDomain: serverResult.value.previewDomain,
    status: "running",
    statusMessage: undefined,
  })
  // Skipped when the client pre-seeded a terminal as the branch's default tab
  // (seedChat === false) so the branch isn't also given an auto chat.
  if (req.seedChat !== false) {
    await ensureChatForBranch(roomId, branchId)
  }

  // Best-effort: crawl routes so the iframeLayer route picker has options without
  // the user (or model) needing to trigger discovery.
  crawlRoutes(clonedSandboxName)
    .then((result) => {
      if (result.success) {
        return updateBranch(roomId, branchId, {
          discoveredRoutes: result.value,
        })
      }
    })
    .catch(() => {})
}

async function runDuplicateBranchPipeline(
  req: CreateRequest,
  repo: RepoData,
  ghToken: string
) {
  const { roomId, branchId, sourceBranch } = req

  if (!sourceBranch) {
    await markError(roomId, branchId, "Source branch not specified")
    return
  }

  // Step 1: Create a new branch from the source branch
  const branchResult = await createAgentBranch(
    repo,
    req.branch,
    sourceBranch,
    ghToken
  )
  if (!branchResult.success) {
    await markError(
      roomId,
      branchId,
      branchResult.error || "Failed to create branch"
    )
    return
  }

  // Step 2: Normal sandbox creation from the new branch. Pass through as
  // "from-branch" since the branch we just created already exists.
  await runNewOrFromBranchPipeline(
    { ...req, flow: "from-branch" },
    repo,
    ghToken
  )
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const ghToken = await getGitHubToken()
  if (!ghToken) {
    return NextResponse.json(
      { error: "No GitHub token — please re-authenticate with GitHub" },
      { status: 401 }
    )
  }

  const body = (await request.json()) as CreateRequest
  const { flow, roomId, branchId, repoId } = body

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

      if (flow === "duplicate-branch") {
        await runDuplicateBranchPipeline(body, repo, ghToken)
      } else {
        await runNewOrFromBranchPipeline(body, repo, ghToken)
      }
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
