import { NextResponse, after } from "next/server"
import { getGitHubToken, getUserId } from "@/lib/auth-helpers"
import { nanoid } from "nanoid"
import { kv } from "@/lib/kv"
import {
  cloneSandbox,
  installDependencies,
  installClaudeCode,
  installRipgrep,
  startDevServer,
} from "@/lib/sandbox/provision"
import { createAgentBranch, configureAgentGit } from "@/lib/sandbox/git"
import { crawlRoutes } from "@/lib/sandbox/inspect"
import { parseEnvVars } from "@/lib/env-utils"
import type { AgentData, WorkspaceData } from "@/lib/types"
import { mutateRoomDoc, readRoomDoc } from "@/lib/yjs/server"

export const runtime = "nodejs"
export const maxDuration = 300

interface CreateRequest {
  flow: "new" | "from-branch" | "duplicate-branch"
  roomId: string
  agentId: string
  sandboxName: string
  branch: string
  workspaceId: string
  sourceBranch?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function updateAgent(
  roomId: string,
  agentId: string,
  data: Partial<AgentData>,
) {
  await mutateRoomDoc(roomId, ({ agents }) => {
    agents.update(agentId, data)
  })
}

async function getWorkspaceFromStorage(
  roomId: string,
  workspaceId: string,
): Promise<WorkspaceData | null> {
  return readRoomDoc(roomId, ({ workspaces }) => workspaces.get(workspaceId) ?? null)
}


/**
 * Ensure a chat session exists for the agent. IframeLayers + groups are
 * pre-created on the client at agent-creation time (see
 * `seedIframeLayerForAgent` in canvas.tsx) — doing layout server-side raced
 * across parallel pipelines because each `mutateRoomDoc` call is a
 * snapshot-then-write rather than a serialized transaction. Chats stay
 * server-created for single-agent flows that don't pre-seed them.
 */
async function ensureChatForAgent(roomId: string, agentId: string) {
  await mutateRoomDoc(roomId, ({ agents, chatSessions, transact }) => {
    if (!agents.get(agentId)) return
    transact(() => {
      const hasChat = chatSessions.toArray().some((cs) => cs.agentId === agentId)
      if (!hasChat) {
        const chatId = nanoid()
        chatSessions.set(chatId, {
          id: chatId,
          agentId,
          label: "Untitled",
          createdAt: Date.now(),
        })
      }
    })
  })
}

function markError(roomId: string, agentId: string, error?: string) {
  return updateAgent(roomId, agentId, {
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
  workspace: WorkspaceData,
  ghToken: string,
) {
  const { flow, roomId, agentId, sandboxName, branch } = req
  const env = parseEnvVars(workspace.envVars)
  const envOrUndefined = Object.keys(env).length > 0 ? env : undefined

  // Step 1: Create branch (skip for from-branch flow)
  if (flow === "new") {
    const branchResult = await createAgentBranch(workspace, branch, undefined, ghToken)
    if (!branchResult.success) {
      await markError(roomId, agentId, branchResult.error || "Failed to create branch")
      return
    }
  }

  // Step 2: Clone repo into sandbox
  await updateAgent(roomId, agentId, { statusMessage: "Cloning repository…" })
  const cloneResult = await cloneSandbox(sandboxName, workspace.cloneUrl, branch, workspace.devServerPort, envOrUndefined, ghToken)
  if (!cloneResult.success) {
    await markError(roomId, agentId, cloneResult.error)
    return
  }
  const clonedSandboxName = cloneResult.value.sandboxName

  // Step 3: Install dependencies + Claude Code + ripgrep in parallel.
  // Claude Code and ripgrep are best-effort — their results are intentionally
  // ignored here so a failed CLI/tool install doesn't fail the pipeline (each
  // action still reports failure truthfully; this caller chooses to swallow it).
  await updateAgent(roomId, agentId, { statusMessage: "Installing dependencies…" })
  const [installResult] = await Promise.all([
    installDependencies(clonedSandboxName, workspace.setupScript),
    installClaudeCode(clonedSandboxName),
    installRipgrep(clonedSandboxName),
  ])
  if (!installResult.success) {
    await markError(roomId, agentId, installResult.error)
    return
  }

  // Step 4: Start dev server
  await updateAgent(roomId, agentId, { statusMessage: "Starting dev server…" })
  const serverResult = await startDevServer(clonedSandboxName, workspace.devServerPort, workspace.devScript)
  if (!serverResult.success) {
    await markError(roomId, agentId, serverResult.error)
    return
  }

  // Step 5: Configure git
  await updateAgent(roomId, agentId, { statusMessage: "Configuring git…" })
  const gitResult = await configureAgentGit(clonedSandboxName, workspace, branch)
  if (!gitResult.success) {
    await markError(roomId, agentId, gitResult.error)
    return
  }

  // Done
  await updateAgent(roomId, agentId, {
    previewDomain: serverResult.value.previewDomain,
    status: "running",
    statusMessage: undefined,
  })
  await ensureChatForAgent(roomId, agentId)

  // Best-effort: crawl routes so the iframeLayer route picker has options without
  // the user (or model) needing to trigger discovery.
  crawlRoutes(clonedSandboxName).then((result) => {
    if (result.success) {
      return updateAgent(roomId, agentId, { discoveredRoutes: result.value })
    }
  }).catch(() => {})
}


async function runDuplicateBranchPipeline(
  req: CreateRequest,
  workspace: WorkspaceData,
  ghToken: string,
) {
  const { roomId, agentId, sourceBranch } = req

  if (!sourceBranch) {
    await markError(roomId, agentId, "Source branch not specified")
    return
  }

  // Step 1: Create a new branch from the source branch
  const branchResult = await createAgentBranch(workspace, req.branch, sourceBranch, ghToken)
  if (!branchResult.success) {
    await markError(roomId, agentId, branchResult.error || "Failed to create branch")
    return
  }

  // Step 2: Normal sandbox creation from the new branch. Pass through as
  // "from-branch" since the branch we just created already exists.
  await runNewOrFromBranchPipeline(
    { ...req, flow: "from-branch" },
    workspace,
    ghToken,
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
      { status: 401 },
    )
  }

  const body = (await request.json()) as CreateRequest
  const { flow, roomId, agentId, workspaceId } = body

  // Distributed lock — prevent duplicate creation (page reload, multiplayer)
  const lock = await kv.acquireLock(`agent-create:${agentId}`, 300)
  if (!lock) {
    // Another instance is already handling this agent's creation
    return NextResponse.json({ ok: true })
  }

  after(async () => {
    try {
      const workspace = await getWorkspaceFromStorage(roomId, workspaceId)
      if (!workspace) {
        await markError(roomId, agentId, "Workspace not found")
        return
      }

      if (flow === "duplicate-branch") {
        await runDuplicateBranchPipeline(body, workspace, ghToken)
      } else {
        await runNewOrFromBranchPipeline(body, workspace, ghToken)
      }
    } catch (e) {
      await markError(
        roomId,
        agentId,
        e instanceof Error ? e.message : "Unexpected error during sandbox creation",
      ).catch(() => {})
    } finally {
      await lock.release().catch(() => {})
    }
  })

  return NextResponse.json({ ok: true })
}
