import { NextResponse, after } from "next/server"
import { getUserId } from "@/lib/auth-helpers"
import { nanoid } from "nanoid"
import { LiveObject } from "@liveblocks/client"
import { liveblocks } from "@/lib/liveblocks-server"
import { kv } from "@/lib/kv"
import {
  getGitHubToken,
  createAgentBranch,
  cloneSandbox,
  installDependencies,
  installClaudeCode,
  startDevServer,
  configureAgentGit,
} from "@/lib/sandbox-actions"
import { parseEnvVars } from "@/lib/env-utils"
import type { AgentData, ArtboardData, ChatSessionData, WorkspaceData } from "@/lib/liveblocks.types"
import {
  DEFAULT_ARTBOARD_WIDTH,
  DEFAULT_ARTBOARD_HEIGHT,
  CANVAS_SIZE,
} from "@/lib/constants"

export const runtime = "nodejs"
export const maxDuration = 300

interface CreateRequest {
  flow: "new" | "from-branch" | "duplicate-branch"
  roomId: string
  agentId: string
  sandboxName: string
  branch: string
  workspaceId: string
  viewportCenter?: { x: number; y: number }
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
  await liveblocks.mutateStorage(roomId, ({ root }) => {
    const agent = root.get("sandboxes").get(agentId)
    if (!agent) return
    for (const [key, value] of Object.entries(data)) {
      agent.set(key as keyof AgentData, value as never)
    }
  })
}

async function getWorkspaceFromStorage(
  roomId: string,
  workspaceId: string,
): Promise<WorkspaceData | null> {
  let workspace: WorkspaceData | null = null
  await liveblocks.mutateStorage(roomId, ({ root }) => {
    const ws = root.get("workspaces").get(workspaceId)
    if (!ws) return
    workspace = {
      id: workspaceId,
      name: ws.get("name") ?? "",
      repoFullName: ws.get("repoFullName"),
      repoOwner: ws.get("repoOwner"),
      repoName: ws.get("repoName"),
      defaultBranch: ws.get("defaultBranch"),
      cloneUrl: ws.get("cloneUrl"),
      setupScript: ws.get("setupScript") ?? "",
      devScript: ws.get("devScript") ?? "",
      devServerPort: ws.get("devServerPort") ?? 3000,
      envVars: ws.get("envVars") ?? "",
      createdAt: ws.get("createdAt"),
    }
  })
  return workspace
}


async function createArtboardAndChat(
  roomId: string,
  agentId: string,
  viewportCenter?: { x: number; y: number },
) {
  await liveblocks.mutateStorage(roomId, ({ root }) => {
    // Create artboard if none exists for this agent
    const artboardsMap = root.get("artboards")
    let hasArtboard = false
    artboardsMap.forEach((a) => {
      if (a.get("sandboxId") === agentId) hasArtboard = true
    })
    if (!hasArtboard) {
      const allArtboards = Array.from(artboardsMap.values())

      let x: number
      let y: number

      if (allArtboards.length === 0) {
        const cx = viewportCenter?.x ?? CANVAS_SIZE / 2
        const cy = viewportCenter?.y ?? CANVAS_SIZE / 2
        x = cx - DEFAULT_ARTBOARD_WIDTH / 2
        y = cy - DEFAULT_ARTBOARD_HEIGHT / 2
      } else {
        // Place to the right of the rightmost artboard, aligned to the top
        let minY = Infinity
        let maxRight = -Infinity
        for (const a of allArtboards) {
          minY = Math.min(minY, a.get("y"))
          maxRight = Math.max(maxRight, a.get("x") + a.get("width"))
        }
        x = maxRight + 50
        y = minY
      }

      const artboardId = nanoid()
      artboardsMap.set(
        artboardId,
        new LiveObject<ArtboardData>({
          id: artboardId,
          sandboxId: agentId,
          x,
          y,
          width: DEFAULT_ARTBOARD_WIDTH,
          height: DEFAULT_ARTBOARD_HEIGHT,
          label: "Frame 1",
          iframeState: {},
        }),
      )
    }

    // Create chat session if none exists for this agent
    const chatSessionsMap = root.get("chatSessions")
    if (chatSessionsMap) {
      let hasChat = false
      chatSessionsMap.forEach((cs) => {
        if (cs.get("agentId") === agentId) hasChat = true
      })
      if (!hasChat) {
        const chatId = nanoid()
        chatSessionsMap.set(
          chatId,
          new LiveObject<ChatSessionData>({
            id: chatId,
            agentId,
            label: "Untitled",
            createdAt: Date.now(),
          }),
        )
      }
    }
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

  // Step 3: Install dependencies + Claude Code in parallel.
  // Claude Code is best-effort — a failure there shouldn't fail the pipeline.
  await updateAgent(roomId, agentId, { statusMessage: "Installing dependencies…" })
  const [installResult] = await Promise.all([
    installDependencies(cloneResult.sandboxName, workspace.setupScript),
    installClaudeCode(cloneResult.sandboxName),
  ])
  if (!installResult.success) {
    await markError(roomId, agentId, installResult.error)
    return
  }

  // Step 4: Start dev server
  await updateAgent(roomId, agentId, { statusMessage: "Starting dev server…" })
  const serverResult = await startDevServer(cloneResult.sandboxName, workspace.devServerPort, workspace.devScript)
  if (serverResult.status !== "running") {
    await markError(roomId, agentId, serverResult.error)
    return
  }

  // Step 5: Configure git
  await updateAgent(roomId, agentId, { statusMessage: "Configuring git…" })
  const gitResult = await configureAgentGit(cloneResult.sandboxName, workspace, branch)
  if (!gitResult.success) {
    await markError(roomId, agentId, gitResult.error)
    return
  }

  // Done
  await updateAgent(roomId, agentId, {
    previewDomain: serverResult.previewDomain,
    status: "running",
    statusMessage: undefined,
  })
  await createArtboardAndChat(roomId, agentId, req.viewportCenter)
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

  // Step 2: Normal sandbox creation from the new branch
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
  const lockKey = `agent-create:${agentId}`
  const acquired = await kv.set(lockKey, "1", { nx: true, ex: 300 })
  if (!acquired) {
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
      await kv.del(lockKey).catch(() => {})
    }
  })

  return NextResponse.json({ ok: true })
}
