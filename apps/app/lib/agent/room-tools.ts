import "server-only"

import { tool, jsonSchema, type ToolSet } from "ai"
import { nanoid } from "nanoid"
import { buildArrangeTools } from "@/lib/agent/room-arrange-tools"
import { buildViewTools } from "@/lib/agent/room-view-tools"
import {
  getGroupMembers,
  groupContentHeight,
  groupContentWidth,
} from "@/lib/canvas/layout"
import { COLLECTION_KEYS, type RoomCollections } from "@/lib/yjs/schema"
import { isFreshWorkspace } from "@/lib/fresh-workspace"
import { workspaceLabel } from "@/lib/workspace-label"
import {
  buildWorkspaceReadTools,
  type WorkspaceReadPorts,
} from "@/lib/agent/room-read-tools"
import { annotateTools } from "@/lib/mcp/tool-server"
import { isBranchBusy } from "@/lib/branch-busy"
import {
  createdWorkspacesResult,
  queuedForWorkspaceResult,
  sentToWorkspaceResult,
  CREATE_WORKSPACES_TOOL,
  OPEN_PULL_REQUEST_TOOL,
  REMOVE_WORKSPACE_TOOL,
  type WorkspaceCreateOutcome,
} from "@/lib/agent/workspace-task"
import { hasGitHubRemote } from "@/lib/repo-identity"
import { DEFAULT_DEV_SERVER_PORT } from "@/lib/run-settings"
import { createCanvasOps } from "@/lib/canvas/ops"
import { createRoomCollections } from "@/lib/yjs/schema"
import { sanitizeBranchName } from "@/lib/branch-rename"
import { workspaceChatId } from "@/lib/chat/workspace-chat"
import { isSketchChat, sketchChatSession } from "@/lib/chat/sketch-chat"
import { MOCKUP_STATUS_LABELS, mockupStatusOf } from "@/lib/mockup-status"
import type { BranchProvisionRequest } from "@/lib/branch/provisioning-live"
import type {
  BranchData,
  ChatSessionData,
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
  MockupLayerData,
  PlanData,
  RepoData,
} from "@/lib/types"

/**
 * The **Coordinator tools module**: every tool a Room Target chat (the
 * Coordinator, `apps/app/CONTEXT.md`) runs lives behind {@link buildRoomTools}.
 * The in-process engine's tool set calls it, and so does the desktop MCP
 * server (`coordinator-mcp.ts`), so each tool is defined once.
 *
 * It takes a Room id plus {@link RoomToolPorts}: the things it drives, injected
 * so tests run every tool against a bare Room doc. Tools that change the canvas
 * write through Canvas Operations inside `mutateDoc` (a server-side room
 * mutation, ADR 0001), logged per turn so the Coordinator can undo a turn when
 * asked (`room-arrange-tools.ts`, `room-change-log.ts`). Memory is every
 * chat kind's (`memory-tools.ts`).
 */
export interface RoomToolPorts extends WorkspaceReadPorts {
  /** Read-only access to the Room's doc, as `RoomAccess.readDoc`. */
  readDoc<T>(fn: (collections: RoomCollections) => T | Promise<T>): Promise<T>
  /** A server-side room mutation, as `RoomAccess.mutateDoc`. */
  mutateDoc<T = void>(
    fn: (collections: RoomCollections) => T | Promise<T>
  ): Promise<T>
  /** The acting member's Terminal Tabs in this Room (tabs are per user). */
  listTerminalTabs(): Promise<TerminalTabSummary[]>
  /**
   * Start a turn in a Workspace chat carrying a Delegated Message, through
   * Turn Launch. Resolves once the turn is queued (the message persisted and
   * broadcast), never when it ends.
   */
  launchWorkspaceTurn(input: WorkspaceTurnRequest): Promise<void>
  /**
   * Start a turn in a chat with no repository (a Sketch Chat) carrying a
   * Delegated Message, as {@link launchWorkspaceTurn} does for a Workspace.
   */
  launchSketchTurn(input: SketchTurnRequest): Promise<void>
  /**
   * Start provisioning a Workspace `create_workspaces` created (#898), as
   * `/api/branch/create` does. Resolves once provisioning is under way; a
   * failure later lands on the Branch as `error`. Throws when it can't start.
   */
  provisionWorkspace(request: BranchProvisionRequest): Promise<void>
  /** Stop a Workspace chat's running turn, as that chat's Stop button does. */
  stopWorkspaceTurn(chatId: string): Promise<void>
  /**
   * Open a GitHub PR for a Workspace's branch as `ownerId`, the Workspace's
   * owner (#901), the way the sidebar's Create PR does.
   */
  openPullRequest(request: {
    sandboxName: string
    ownerId: string
  }): Promise<{ url: string; number: number }>
  /** Tear down a removed Workspace's sandbox, as the sidebar's delete does. */
  deleteSandbox(sandboxName: string): Promise<void>
  /**
   * The member Workspaces this turn creates belong to: whoever sent the
   * message the turn answers or, on a wake turn, the owner of the Workspace
   * that woke it ({@link wakeRequesterId}).
   */
  requesterId: string
  /** The Coordinator chat these tools run for. */
  coordinatorChatId: string
}

/** A Delegated Message on its way into a Workspace chat. */
export type WorkspaceTurnRequest = {
  branchId: string
  sandboxName: string
  chatId: string
  /** The message as the Coordinator wrote it, before any turn marker. */
  message: string
  /**
   * True when this is the Workspace's only chat, so its first turn may name
   * the Workspace and its branch, as a first chat typed by hand does.
   */
  isFirstChat: boolean
  model?: string
}

/** A Delegated Message on its way into a chat with no repository. */
export type SketchTurnRequest = {
  chatId: string
  /** The message as the Coordinator wrote it, before any turn marker. */
  message: string
  model?: string
}

/** What the Coordinator sees of a Terminal Tab: never its scrollback. */
export type TerminalTabSummary = {
  id: string
  label: string
  /** The Branch (Workspace) the terminal runs against. */
  branchId: string
}

/**
 * The Coordinator's tools for one turn: each call builds a new turn's tool set,
 * and the canvas changes its tools make are logged under that turn.
 */
export function buildRoomTools(
  roomId: string,
  ports: RoomToolPorts,
  turnId: string = nanoid()
): ToolSet {
  const tools = {
    read_canvas: tool({
      description:
        "Read a compact summary of the whole canvas: its repositories, Workspaces (title, branch, status, changed lines, PR), Groups (name, position, what they hold), frames (label, route, size, Workspace), documents, mockups and Terminal Tabs. Call it before answering anything about what is on the canvas; ids in the result are what other tools take.",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
      }),
      execute: async () => {
        const terminalTabs = await ports.listTerminalTabs().catch(() => [])
        const summary = await ports.readDoc((collections) =>
          summarizeCanvas(collections, terminalTabs)
        )
        return summary || `Canvas ${roomId} is empty.`
      },
    }),
    send_to_workspace: tool({
      description:
        "Send a message into a Workspace's chat, as a new turn for its agent. Use it to hand a Workspace work or a follow-up; the user sees it in that chat and can take over at any time. It returns as soon as the message is queued, never waiting for the turn: you hear back when the turn ends. It refuses a Workspace whose agent is working, whose sandbox isn't running, or whose plan waits on the user (only the user approves plans). A fresh Workspace whose sandbox is still starting takes the message and gets it as soon as it runs.",
      inputSchema: jsonSchema<{ workspace_id: string; message: string }>({
        type: "object",
        properties: {
          workspace_id: {
            type: "string",
            description: "The Workspace's id, from `read_canvas`.",
          },
          message: {
            type: "string",
            description:
              "What the Workspace's agent should do, written as the user would write it.",
          },
        },
        required: ["workspace_id", "message"],
      }),
      execute: async ({ workspace_id, message }) =>
        sendToWorkspace(ports, workspace_id, message),
    }),
    [CREATE_WORKSPACES_TOOL]: tool({
      description:
        "Create Workspaces, each seeded with a first message for its agent. Use it when the user asks for work no existing Workspace fits; send follow-ups to an existing Workspace with `send_to_workspace` instead. It creates them right away, their frames together in one new Group, and returns each one's id and whether it started. There's no limit on how many you list, but create only what the ask needs.",
      inputSchema: jsonSchema<CreateWorkspacesInput>({
        type: "object",
        properties: {
          workspaces: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                title: {
                  type: "string",
                  description:
                    'The Workspace\'s title: a few words naming the work, e.g. "Fix sign-in redirect".',
                },
                repository: {
                  type: "string",
                  description:
                    "One of the canvas's repositories, by full name (owner/name) as `read_canvas` lists it.",
                },
                base_branch: {
                  type: "string",
                  description:
                    "The branch to start from. Defaults to the repository's default branch.",
                },
                prompt: {
                  type: "string",
                  description:
                    "The seed message its agent starts on, written as the user would write it.",
                },
              },
              required: ["title", "repository", "prompt"],
            },
          },
        },
        required: ["workspaces"],
      }),
      execute: async (input) => createWorkspaces(ports, input),
    }),
    [OPEN_PULL_REQUEST_TOOL]: tool({
      description:
        "Open a pull request on GitHub for a Workspace's branch, into its repository's default branch. It opens right away, with the GitHub account of the Workspace's owner, and returns the PR's link. Its title and description come from the branch's commits, so make sure the Workspace's agent has committed and pushed first.",
      inputSchema: jsonSchema<{ workspace_id: string }>({
        type: "object",
        properties: {
          workspace_id: {
            type: "string",
            description: "The Workspace's id, from `read_canvas`.",
          },
        },
        required: ["workspace_id"],
      }),
      execute: async ({ workspace_id }) => openPullRequest(ports, workspace_id),
    }),
    [REMOVE_WORKSPACE_TOOL]: tool({
      description:
        "Remove a Workspace from the canvas, as Delete in the Chats menu does: its chats and frames go and its sandbox is torn down, which can't be undone. The git branch and any PR stay on GitHub. It acts right away.",
      inputSchema: jsonSchema<{ workspace_id: string }>({
        type: "object",
        properties: {
          workspace_id: {
            type: "string",
            description: "The Workspace's id, from `read_canvas`.",
          },
        },
        required: ["workspace_id"],
      }),
      execute: async ({ workspace_id }) => removeWorkspace(ports, workspace_id),
    }),
    stop_workspace: tool({
      description:
        "Stop a Workspace's running turn right away, as its chat's Stop button does. Use it when a Workspace's work has gone off track or the user asks you to stop it. Its chat keeps everything so far; send it a message to carry on.",
      inputSchema: jsonSchema<{ workspace_id: string }>({
        type: "object",
        properties: {
          workspace_id: {
            type: "string",
            description: "The Workspace's id, from `read_canvas`.",
          },
        },
        required: ["workspace_id"],
      }),
      execute: async ({ workspace_id }) => stopWorkspace(ports, workspace_id),
    }),
    start_chat: tool({
      description:
        "Start a chat with no repository, seeded with a first message. It writes Documents and Mockups only: no code, sandbox or frames. Use it for a document or mockup when the canvas has no repository, or when the ask isn't about any repository's code. It starts right away and returns the chat's id; you hear back when its turn ends.",
      inputSchema: jsonSchema<{ title: string; prompt: string }>({
        type: "object",
        properties: {
          title: {
            type: "string",
            description:
              'The chat\'s title: a few words naming the work, e.g. "Pricing page sketch".',
          },
          prompt: {
            type: "string",
            description:
              "The seed message the chat starts on, written as the user would write it.",
          },
        },
        required: ["title", "prompt"],
      }),
      execute: async ({ title, prompt }) => startChat(ports, title, prompt),
    }),
    send_to_chat: tool({
      description:
        "Send a message into a chat with no repository, as a new turn. Use it for a follow-up on a Document or Mockup that chat made. It returns as soon as the message is queued; you hear back when the turn ends. It refuses a chat that is working.",
      inputSchema: jsonSchema<{ chat_id: string; message: string }>({
        type: "object",
        properties: {
          chat_id: {
            type: "string",
            description: "The chat's id, from `read_canvas`.",
          },
          message: {
            type: "string",
            description:
              "What the chat should do, written as the user would write it.",
          },
        },
        required: ["chat_id", "message"],
      }),
      execute: async ({ chat_id, message }) =>
        sendToChat(ports, chat_id, message),
    }),
  }
  return {
    ...buildArrangeTools(ports.mutateDoc, turnId),
    ...buildViewTools(ports.readDoc),
    ...buildWorkspaceReadTools(ports),
    // MCP annotations, sent when a desktop harness lists the tools (#903).
    // Give each tool the honest hints: no Screenplay tool asks the user first
    // on either harness (#1217), and that is the harness's configuration, not
    // the hints. Claude Code pre-allows every tool on the server
    // (`COORDINATOR_ALLOWED_TOOLS`). Codex asks for a tool that isn't
    // `readOnlyHint` or both `destructiveHint: false` and `openWorldHint:
    // false`, but it asks the ACP client, and the external engine allows
    // every such request on a Coordinator turn, which is never in plan mode
    // (`acp-engine.ts`).
    ...annotateTools(tools, {
      read_canvas: { readOnlyHint: true, openWorldHint: false },
      // Starts a turn in a Workspace chat the user can see and take over.
      send_to_workspace: { destructiveHint: false, openWorldHint: false },
      // Creates Workspaces the user can remove again (#898).
      [CREATE_WORKSPACES_TOOL]: {
        destructiveHint: false,
        openWorldHint: false,
      },
      // Stops a turn the user can resume by messaging the Workspace again.
      stop_workspace: { destructiveHint: false, openWorldHint: false },
      // Chats with no repository: Documents and Mockups only.
      start_chat: { destructiveHint: false, openWorldHint: false },
      send_to_chat: { destructiveHint: false, openWorldHint: false },
      // A PR on GitHub, and a removal that tears the sandbox down for good
      // (#901).
      [OPEN_PULL_REQUEST_TOOL]: { destructiveHint: false, openWorldHint: true },
      [REMOVE_WORKSPACE_TOOL]: { destructiveHint: true, openWorldHint: false },
    }),
  }
}

/** One Workspace in a `create_workspaces` call, as the model writes it. */
export type WorkspaceSpec = {
  title: string
  repository: string
  base_branch?: string
  prompt: string
}

type CreateWorkspacesInput = { workspaces: WorkspaceSpec[] }

/**
 * The owner of Workspaces a wake turn creates (#890): the owner of the
 * Workspace that woke the Coordinator, or `fallback` for one created before
 * owners were recorded.
 */
export function wakeRequesterId(
  wakingBranch: Pick<BranchData, "createdBy"> | undefined,
  fallback: string
): string {
  return wakingBranch?.createdBy ?? fallback
}

function cleanSpec(raw: WorkspaceSpec): WorkspaceSpec {
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const base = text(raw?.base_branch)
  return {
    title: text(raw?.title),
    repository: text(raw?.repository),
    ...(base ? { base_branch: base } : {}),
    prompt: text(raw?.prompt),
  }
}

function findRepo(
  repos: readonly RepoData[],
  name: string
): RepoData | undefined {
  const key = name.trim().toLowerCase()
  return repos.find(
    (r) => r.id === name.trim() || r.repoFullName.toLowerCase() === key
  )
}

/**
 * Create the Workspaces a `create_workspaces` call asks for (#898), each
 * owned by the turn's requester and seeded with its prompt once its sandbox
 * runs. Every Workspace is created before any is provisioned, together in one
 * new Group of frames; a Workspace that fails to start is marked failed (its
 * row offers Retry) and the rest carry on. Returns the tool result the
 * Coordinator reads, naming each Workspace so its task row shows.
 */
async function createWorkspaces(
  ports: RoomToolPorts,
  input: CreateWorkspacesInput
): Promise<string> {
  const outcomes: WorkspaceCreateOutcome[] = []
  const toProvision: {
    outcome: WorkspaceCreateOutcome
    request: BranchProvisionRequest
  }[] = []

  await ports.mutateDoc((collections) => {
    const repos = records<RepoData>(collections, COLLECTION_KEYS.repos)
    const taken = new Set(
      records<BranchData>(collections, COLLECTION_KEYS.branches).map(
        (b) => b.ref
      )
    )
    const ops = createCanvasOps(createRoomCollections(collections.doc))
    const frames: { agentId: string; label: string }[] = []
    ops.batch(() => {
      for (const spec of (input?.workspaces ?? []).map(cleanSpec)) {
        const title = spec.title || "Untitled"
        const repo = findRepo(repos, spec.repository)
        if (!repo) {
          outcomes.push({
            title,
            repository: spec.repository,
            error: "that repository isn't on this canvas",
          })
          continue
        }
        if (!spec.prompt) {
          outcomes.push({
            title,
            repository: repo.repoFullName,
            error: "it had no seed prompt",
          })
          continue
        }
        const ref = uniqueRef(title, taken)
        const sandboxName = `sp-${nanoid(10)}`
        const base = spec.base_branch
        const flow =
          base && base !== repo.defaultBranch ? "duplicate-branch" : "new"
        const chatId = nanoid()
        const { branchId } = ops.createBranch({
          branch: {
            repoId: repo.id,
            sandboxName,
            gitUrl: repo.cloneUrl,
            ref,
            title,
            previewDomain: "",
            port: repo.devServerPort ?? DEFAULT_DEV_SERVER_PORT,
            status: "creating",
            statusMessage: "Setting up the workspace…",
            createdAt: Date.now(),
            // Titled up front, so the seed message mustn't rename the branch.
            autoNamedBranch: false,
            createFlow: flow,
            ...(flow === "duplicate-branch"
              ? { createSourceBranch: base }
              : {}),
            createdBy: ports.requesterId,
            pendingSeed: {
              chatId,
              message: spec.prompt,
              coordinatorChatId: ports.coordinatorChatId,
            },
          },
        })
        collections.chatSessions.set(chatId, {
          id: chatId,
          branchId,
          label: title,
          createdAt: Date.now(),
        })
        frames.push({ agentId: branchId, label: title })
        const outcome: WorkspaceCreateOutcome = {
          title,
          repository: repo.repoFullName,
          branchId,
        }
        outcomes.push(outcome)
        toProvision.push({
          outcome,
          request: {
            flow,
            branchId,
            sandboxName,
            branch: ref,
            repoId: repo.id,
            ...(flow === "duplicate-branch" ? { sourceBranch: base } : {}),
            // The seed chat exists already.
            seedChat: false,
          },
        })
      }
      // One Group holds every new Workspace's frame, beside the others.
      ops.createFramesForAgents(frames, { x: 0, y: 0 })
    })
  })

  for (const { outcome, request } of toProvision) {
    try {
      await ports.provisionWorkspace(request)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      outcome.error = error
      await ports
        .mutateDoc(({ branches }) =>
          branches.update(request.branchId, { status: "error", error })
        )
        .catch(() => {})
    }
  }
  return createdWorkspacesResult(outcomes)
}

/** A Workspace's open PR, if it has one. */
function openPr(branch: BranchData): number | null {
  return branch.prNumber && (branch.prState ?? "open") === "open"
    ? branch.prNumber
    : null
}

/**
 * What a Workspace tool returns for an id no Workspace has. Like every
 * refusal these tools return, it's a result, not an error: the call did what
 * it should, so its row isn't shown as failed (#1231).
 */
function noSuchWorkspace(id: string): string {
  return `No Workspace has the id ${id || "(none)"}. Call read_canvas for current ids.`
}

function workspaceIdOf(input: unknown): string {
  return typeof input === "string" ? input.trim() : ""
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`
}

function joinFacts(facts: string[]): string {
  if (facts.length <= 1) return facts[0] ?? ""
  return `${facts.slice(0, -1).join(", ")} and ${facts[facts.length - 1]}`
}

/**
 * Open the Workspace's PR (#901) from its branch into the repository's
 * default branch, with its owner's GitHub account (#890: the Coordinator acts
 * as each Workspace's owner, whoever asked), then record it on the Workspace
 * so its row and badge show it now. A Workspace that already has a PR open,
 * or isn't in a GitHub repository, is refused.
 */
async function openPullRequest(
  ports: RoomToolPorts,
  workspaceId: unknown
): Promise<string> {
  const id = workspaceIdOf(workspaceId)
  // The raw maps, never a cached collection snapshot.
  const target = await ports.readDoc((c) => {
    const branch = records<BranchData>(c, COLLECTION_KEYS.branches).find(
      (b) => b.id === id
    )
    if (!branch) return null
    const repo = records<RepoData>(c, COLLECTION_KEYS.repos).find(
      (r) => r.id === branch.repoId
    )
    return { branch, repo }
  })
  if (!target) return noSuchWorkspace(id)
  const { branch, repo } = target
  const title = workspaceLabel(branch)
  const existing = openPr(branch)
  if (existing) return `"${title}" already has PR #${existing} open.`
  if (!repo || !hasGitHubRemote(repo)) {
    return `"${title}" isn't in a GitHub repository, so it can't have a pull request.`
  }
  const { url, number } = await ports.openPullRequest({
    sandboxName: branch.sandboxName,
    ownerId: workspaceOwnerId(branch, ports.requesterId),
  })
  await ports.mutateDoc(({ branches }) =>
    branches.update(branch.id, {
      prNumber: number,
      prUrl: url,
      prState: "open",
    })
  )
  return `Opened PR #${number} for "${title}": ${url}`
}

/**
 * The member whose GitHub account acts for a Workspace: its owner, or
 * `fallback` (whoever asked) for one created before owners were recorded.
 */
export function workspaceOwnerId(
  branch: Pick<BranchData, "createdBy">,
  fallback: string
): string {
  return branch.createdBy ?? fallback
}

/**
 * Remove the Workspace the way Delete in the Chats menu does (#901): the
 * Branch, its frames and chats leave the doc in one change, then its sandbox
 * is torn down. The git branch and any PR stay where they are.
 */
async function removeWorkspace(
  ports: RoomToolPorts,
  workspaceId: unknown
): Promise<string> {
  const id = workspaceIdOf(workspaceId)
  const removed = await ports.mutateDoc((collections) => {
    const branch = collections.branches.get(id)
    if (!branch) return null
    const chats = records<ChatSessionData>(
      collections,
      COLLECTION_KEYS.chatSessions
    ).filter((chat) => chat.branchId === id).length
    const frames = records<IframeLayerData>(
      collections,
      COLLECTION_KEYS.iframeLayers
    ).filter((f) => f.branchId === id).length
    createCanvasOps(createRoomCollections(collections.doc)).removeBranch(
      branch.id
    )
    return { branch, chats, frames }
  })
  if (!removed) return noSuchWorkspace(id)
  const { branch, chats, frames } = removed
  if (branch.sandboxName) {
    await ports.deleteSandbox(branch.sandboxName).catch(() => {})
  }
  const gone = [
    chats > 0 && plural(chats, "chat"),
    frames > 0 && plural(frames, "frame"),
    "its sandbox",
  ].filter((f): f is string => Boolean(f))
  const pr = openPr(branch)
  return `Removed "${workspaceLabel(branch)}": ${joinFacts(gone)}.${pr ? ` PR #${pr} stays open on GitHub.` : ""}`
}

/** A branch name from the title, unique among `taken` (which it joins). */
function uniqueRef(title: string, taken: Set<string>): string {
  const stem =
    sanitizeBranchName(title).slice(0, 50).replace(/-+$/, "") || "workspace"
  let ref = stem
  for (let n = 2; taken.has(ref); n++) ref = `${stem}-${n}`
  taken.add(ref)
  return ref
}

/** Stop every running turn in a Workspace's open chats. */
async function stopWorkspace(
  ports: RoomToolPorts,
  branchId: string
): Promise<string> {
  const { title, running } = await ports.readDoc((collections) => {
    const branch = collections.branches.get(branchId)
    if (!branch) {
      throw new Error(
        `No Workspace has the id ${branchId}. Call read_canvas for current ids.`
      )
    }
    const chats = records<ChatSessionData>(
      collections,
      COLLECTION_KEYS.chatSessions
    )
    return {
      title: workspaceLabel(branch),
      running: chats
        .filter((c) => isBranchBusy(branchId, [c]))
        .map((c) => c.id),
    }
  })
  if (running.length === 0) {
    return `"${title}" isn't working on a turn, so there was nothing to stop.`
  }
  for (const chatId of running) await ports.stopWorkspaceTurn(chatId)
  return `Stopped "${title}". Its chat keeps what it did so far.`
}

/**
 * The Workspace chat a Delegated Message goes to: the Workspace's newest open
 * chat, or a new one when every chat is closed. Throws (the tool call then
 * fails with the reason) when the Workspace can't take a message now.
 */
async function sendToWorkspace(
  ports: RoomToolPorts,
  branchId: string,
  rawMessage: string
): Promise<string> {
  const message = rawMessage.trim()
  if (!message) throw new Error("The message is empty.")

  const target = await ports.mutateDoc((collections) => {
    const branch = collections.branches.get(branchId)
    if (!branch) {
      throw new Error(
        `No Workspace has the id ${branchId}. Call read_canvas for current ids.`
      )
    }
    const title = workspaceLabel(branch)
    // A fresh Workspace still starting (#1182) takes the message as its seed, sent once its sandbox runs.
    const starting =
      branch.status === "creating" || branch.status === "starting"
    if (starting && branch.pendingSeed) {
      throw new Error(
        `"${title}" is still starting and already has a message waiting. Wait until it runs, then send the next one.`
      )
    }
    const queue = starting && isFreshWorkspace(branch)
    if (branch.status !== "running" && !queue) {
      throw new Error(
        `"${title}" isn't running (its sandbox is ${branch.status}), so it can't take a message.`
      )
    }
    const chats = records<ChatSessionData>(
      collections,
      COLLECTION_KEYS.chatSessions
    )
    if (isBranchBusy(branchId, chats)) {
      throw new Error(
        `"${title}" is working on a turn. Wait until it ends, then send the message.`
      )
    }
    const plans = records<PlanData>(collections, COLLECTION_KEYS.plans)
    if (plans.some((p) => p.branchId === branchId && p.status === "pending")) {
      throw new Error(
        `"${title}" is waiting for the user to approve its plan. Only the user approves plans: tell them it's waiting.`
      )
    }
    // The Workspace's one chat (#1315); a fresh one only when it has none.
    const ownId = workspaceChatId(chats, branchId)
    const own = ownId ? chats.find((c) => c.id === ownId) : undefined
    let target: {
      chatId: string
      model: string | undefined
      isFirstChat: boolean
    }
    if (own) {
      target = {
        chatId: own.id,
        model: own.model,
        isFirstChat: chats.filter((c) => c.branchId === branchId).length === 1,
      }
    } else {
      const chat: ChatSessionData = {
        id: nanoid(),
        branchId,
        label: "Untitled",
        createdAt: Date.now(),
      }
      collections.chatSessions.set(chat.id, chat)
      target = { chatId: chat.id, model: undefined, isFirstChat: true }
    }
    if (queue) {
      // Provisioning sends it the moment the sandbox runs (`sendPendingSeed`),
      // as the first turn, which names the Workspace.
      collections.branches.update(branchId, {
        pendingSeed: {
          chatId: target.chatId,
          message,
          coordinatorChatId: ports.coordinatorChatId,
        },
      })
    }
    return { title, branch, queued: queue, ...target }
  })

  if (target.queued) {
    return queuedForWorkspaceResult(target.title, target.chatId)
  }
  await ports.launchWorkspaceTurn({
    branchId,
    sandboxName: target.branch.sandboxName,
    chatId: target.chatId,
    message,
    isFirstChat: target.isFirstChat,
    model: target.model,
  })
  return sentToWorkspaceResult(target.title, target.chatId)
}

/**
 * Start a chat with no repository (a Sketch Chat) for the turn's requester,
 * seeded with `rawPrompt` as a Delegated Message.
 */
async function startChat(
  ports: RoomToolPorts,
  rawTitle: string,
  rawPrompt: string
): Promise<string> {
  const prompt = typeof rawPrompt === "string" ? rawPrompt.trim() : ""
  if (!prompt) throw new Error("The chat needs a seed prompt.")
  const title =
    (typeof rawTitle === "string" ? rawTitle.trim() : "") || "Untitled"
  const chatId = nanoid()
  await ports.mutateDoc(({ chatSessions }) => {
    chatSessions.set(
      chatId,
      sketchChatSession(chatId, Date.now(), { label: title })
    )
  })
  await ports.launchSketchTurn({ chatId, message: prompt })
  return `Started "${title}" [chat ${chatId}], a chat with no repository. It's working on it now; you'll hear back when its turn ends.`
}

/** Send a Delegated Message into a chat with no repository. */
async function sendToChat(
  ports: RoomToolPorts,
  chatId: string,
  rawMessage: string
): Promise<string> {
  const message = typeof rawMessage === "string" ? rawMessage.trim() : ""
  if (!message) throw new Error("The message is empty.")
  const chat = await ports.readDoc(({ chatSessions }) =>
    chatSessions.get(chatId)
  )
  if (!chat || !isSketchChat(chat)) {
    throw new Error(
      `No chat with no repository has the id ${chatId}. Send to a Workspace with send_to_workspace, or call read_canvas for current ids.`
    )
  }
  if (chat.isStreaming) {
    throw new Error(
      `"${chat.label}" is working on a turn. Wait until it ends, then send the message.`
    )
  }
  await ports.launchSketchTurn({ chatId, message, model: chat.model })
  return `Sent to "${chat.label}" [chat ${chatId}]. It's working on it now; you'll hear back when its turn ends.`
}

/**
 * Per-section caps on the canvas summary. A canvas past them gets a "…and N
 * more" line, so the summary stays well under 25k tokens however big the
 * canvas grows (the size test pins this).
 */
export const CANVAS_SUMMARY_LIMITS = {
  repos: 20,
  workspaces: 100,
  chats: 100,
  groups: 100,
  frames: 150,
  documents: 100,
  mockups: 100,
  terminalTabs: 50,
  /** Longest title, label or route kept, in characters. */
  text: 80,
} as const

/**
 * The canvas summary `read_canvas` returns and the Room Target's system prompt
 * embeds: one line per record, grouped by kind, with ids in brackets.
 */
export function summarizeCanvas(
  collections: RoomCollections,
  terminalTabs: readonly TerminalTabSummary[] = []
): string {
  const repos = records<RepoData>(collections, COLLECTION_KEYS.repos)
  const branches = records<BranchData>(collections, COLLECTION_KEYS.branches)
  const frames = records<IframeLayerData>(
    collections,
    COLLECTION_KEYS.iframeLayers
  )
  const groups = records<IframeLayerGroupData>(
    collections,
    COLLECTION_KEYS.iframeLayerGroups
  )
  const documents = records<MarkdownLayerData>(
    collections,
    COLLECTION_KEYS.markdownLayers
  )
  const mockups = records<MockupLayerData>(
    collections,
    COLLECTION_KEYS.mockupLayers
  )
  const chats = records<ChatSessionData>(
    collections,
    COLLECTION_KEYS.chatSessions
  )
  const sized = [...documents, ...mockups]

  const groupOf = new Map(
    groups.flatMap((g) => getGroupMembers(g).map((m) => [m.id, g.id] as const))
  )
  const repoNames = new Map(repos.map((r) => [r.id, r.repoFullName]))
  const working = new Set(
    chats.filter((c) => c.branchId && c.isStreaming).map((c) => c.branchId)
  )
  const byCreated = <T extends { createdAt?: number }>(a: T, b: T) =>
    (a.createdAt ?? 0) - (b.createdAt ?? 0)
  // A Mockup's chat, or that it was deleted (any chat can change it then).
  const ownerOf = (chatId: string) => {
    const chat = chats.find((c) => c.id === chatId)
    return chat ? `by chat "${clip(chat.label)}"` : "its chat was deleted"
  }

  return [
    section(
      "Repositories",
      [...repos].sort(byCreated),
      CANVAS_SUMMARY_LIMITS.repos,
      (r) =>
        `- ${clip(r.repoFullName)} (default branch ${clip(r.defaultBranch)})`
    ),
    section(
      "Workspaces",
      [...branches].sort(byCreated),
      CANVAS_SUMMARY_LIMITS.workspaces,
      (b) =>
        [
          `- [${b.id}] "${clip(workspaceLabel(b))}"`,
          `branch ${clip(b.ref)}`,
          repoNames.get(b.repoId) && clip(repoNames.get(b.repoId)!),
          workspaceStatus(b, working.has(b.id)),
          // Takes the next ask that fits its repository (#1182).
          isFreshWorkspace(b) && "fresh (no turns yet)",
          lineCounts(b),
          b.prNumber && `PR #${b.prNumber} ${b.prState ?? "open"}`,
        ]
          .filter(Boolean)
          .join(" · ")
    ),
    section(
      "Chats with no repository",
      chats.filter(isSketchChat).sort(byCreated),
      CANVAS_SUMMARY_LIMITS.chats,
      (c) =>
        [
          `- [${c.id}] "${clip(c.label)}"`,
          c.isStreaming ? "working" : "idle",
        ].join(" · ")
    ),
    section("Groups", groups, CANVAS_SUMMARY_LIMITS.groups, (g) =>
      [
        `- [${g.id}] "${clip(g.name ?? "Group")}"`,
        `at ${Math.round(g.x)}, ${Math.round(g.y)}`,
        // Its extent, so a move can clear its neighbours (items sit in one
        // row, left to right, the Group's gap apart).
        `${Math.round(groupContentWidth(g, frames, sized))}×${Math.round(groupContentHeight(g, frames, sized))}`,
        `${getGroupMembers(g).length} items`,
      ].join(" · ")
    ),
    section("Frames", frames, CANVAS_SUMMARY_LIMITS.frames, (f) =>
      [
        `- [${f.id}] "${clip(f.label)}"`,
        f.route ? clip(f.route) : "(no route)",
        `${Math.round(f.width)}×${Math.round(f.height)}`,
        f.branchId ? `Workspace ${f.branchId}` : "no Workspace",
        groupOf.get(f.id) && `Group ${groupOf.get(f.id)}`,
      ]
        .filter(Boolean)
        .join(" · ")
    ),
    section("Documents", documents, CANVAS_SUMMARY_LIMITS.documents, (d) =>
      [
        `- [${d.id}] "${clip(d.title || "Untitled")}"`,
        groupOf.get(d.id) && `Group ${groupOf.get(d.id)}`,
      ]
        .filter(Boolean)
        .join(" · ")
    ),
    section("Mockups", mockups, CANVAS_SUMMARY_LIMITS.mockups, (m) =>
      [
        `- [${m.id}] "${clip(m.title || "Untitled")}"`,
        `${Math.round(m.width)}×${Math.round(m.height)}`,
        MOCKUP_STATUS_LABELS[mockupStatusOf(m)],
        m.ownerChatId && ownerOf(m.ownerChatId),
        groupOf.get(m.id) && `Group ${groupOf.get(m.id)}`,
      ]
        .filter(Boolean)
        .join(" · ")
    ),
    section(
      "Terminal Tabs",
      terminalTabs,
      CANVAS_SUMMARY_LIMITS.terminalTabs,
      (t) => `- [${t.id}] "${clip(t.label)}" · Workspace ${t.branchId}`
    ),
  ]
    .filter(Boolean)
    .join("\n\n")
}

/**
 * A collection's current records, read from the raw Y.Map rather than
 * `YjsCollection.toArray()`, whose snapshot cache only refreshes while
 * something observes it (nothing does on the server).
 */
function records<T>(collections: RoomCollections, key: string): T[] {
  return Object.values(collections.doc.getMap(key).toJSON()) as T[]
}

function section<T>(
  heading: string,
  items: readonly T[],
  limit: number,
  line: (item: T) => string
): string | null {
  if (items.length === 0) return null
  const shown = items.slice(0, limit).map(line)
  if (items.length > limit) shown.push(`…and ${items.length - limit} more`)
  return [`${heading} (${items.length}):`, ...shown].join("\n")
}

function clip(text: string): string {
  const max = CANVAS_SUMMARY_LIMITS.text
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * A Workspace's status in the words the UI uses: its agent working, otherwise
 * its sandbox's state.
 */
function workspaceStatus(branch: BranchData, agentWorking: boolean): string {
  if (branch.doneAt) return "done"
  if (branch.status === "error") return "failed"
  if (branch.status === "stopped") return "stopped"
  if (branch.status === "creating" || branch.status === "starting") {
    return "starting"
  }
  return agentWorking ? "working" : "idle"
}

function lineCounts(branch: BranchData): string | null {
  const added = branch.diffAdditions ?? 0
  const removed = branch.diffDeletions ?? 0
  if (added === 0 && removed === 0) return null
  return `+${added} −${removed}`
}
