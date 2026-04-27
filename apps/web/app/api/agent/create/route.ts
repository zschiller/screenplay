import { NextResponse, after } from "next/server"
import { getUserId } from "@/lib/auth-helpers"
import { nanoid } from "nanoid"
import { kv } from "@/lib/kv"
import {
  getGitHubToken,
  createAgentBranch,
  cloneSandbox,
  crawlRoutes,
  installDependencies,
  installClaudeCode,
  startDevServer,
  configureAgentGit,
} from "@/lib/sandbox-actions"
import { parseEnvVars } from "@/lib/env-utils"
import type { AgentData, WorkspaceData } from "@/lib/types"
import { mutateRoomDoc, readRoomDoc } from "@/lib/yjs/server"
import {
  ARTBOARD_GROUP_GAP,
  DEFAULT_ARTBOARD_WIDTH,
  DEFAULT_ARTBOARD_HEIGHT,
  CANVAS_SIZE,
} from "@/lib/constants"
import { groupContentWidth, nextGroupNumber } from "@/lib/artboard-layout"

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


async function createArtboardAndChat(
  roomId: string,
  agentId: string,
  viewportCenter?: { x: number; y: number },
) {
  await mutateRoomDoc(roomId, ({ artboards, artboardGroups, chatSessions, transact }) => {
    transact(() => {
      const allArtboards = artboards.toArray()
      const hasArtboard = allArtboards.some((a) => a.sandboxId === agentId)
      if (!hasArtboard) {
        const allGroups = artboardGroups.toArray()
        let x: number
        let y: number

        if (allGroups.length === 0) {
          const cx = viewportCenter?.x ?? CANVAS_SIZE / 2
          const cy = viewportCenter?.y ?? CANVAS_SIZE / 2
          x = cx - DEFAULT_ARTBOARD_WIDTH / 2
          y = cy - DEFAULT_ARTBOARD_HEIGHT / 2
        } else {
          // Place to the right of the rightmost group, aligned to the topmost group
          let minY = Infinity
          let maxRight = -Infinity
          for (const g of allGroups) {
            minY = Math.min(minY, g.y)
            const w = groupContentWidth(g, allArtboards)
            if (g.x + w > maxRight) maxRight = g.x + w
          }
          x = maxRight + ARTBOARD_GROUP_GAP
          y = minY
        }

        const artboardId = nanoid()
        const groupId = nanoid()
        artboards.set(artboardId, {
          id: artboardId,
          sandboxId: agentId,
          width: DEFAULT_ARTBOARD_WIDTH,
          height: DEFAULT_ARTBOARD_HEIGHT,
          label: "Frame 1",
          iframeState: {},
        })
        artboardGroups.set(groupId, {
          id: groupId,
          name: `Group ${nextGroupNumber(allGroups)}`,
          x,
          y,
          artboardIds: [artboardId],
        })
      }

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

  // Best-effort: crawl routes so the artboard route picker has options without
  // the user (or model) needing to trigger discovery.
  crawlRoutes(cloneResult.sandboxName).then((result) => {
    if (result.success) {
      return updateAgent(roomId, agentId, { discoveredRoutes: result.routes })
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
