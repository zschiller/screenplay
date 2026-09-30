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
import type { McpToolAnnotations } from "@/lib/mcp/tool-server"
import {
  addMemory,
  editMemory,
  MEMORY_ENTRY_MAX_LENGTH,
  removeMemory,
} from "@/lib/canvas/memory"
import { isBranchBusy } from "@/lib/branch-busy"
import {
  createdWorkspacesResult,
  queuedForWorkspaceResult,
  sentToWorkspaceResult,
  workspacePlanMarkdown,
  CREATE_WORKSPACES_TOOL,
  type WorkspaceCreateOutcome,
} from "@/lib/agent/workspace-task"
import {
  withPlanGate,
  type PlanGateRefusal,
  type PlanGateRequest,
} from "@/lib/agent/plan-gate"
import {
  confirmCancelledResult,
  OPEN_PULL_REQUEST_TOOL,
  REMOVE_WORKSPACE_TOOL,
  type ConfirmCard,
  type ConfirmGateInput,
} from "@/lib/agent/confirm-card"
import { hasGitHubRemote } from "@/lib/repo-identity"
import { getSkill, getSkillIndex } from "@/lib/skills"
import { createCanvasOps } from "@/lib/canvas/ops"
import { createRoomCollections } from "@/lib/yjs/schema"
import { sanitizeBranchName } from "@/lib/branch-rename"
import type { BranchProvisionRequest } from "@/lib/branch/provisioning-live"
import type {
  BranchData,
  ChatSessionData,
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
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
 * asked (`room-arrange-tools.ts`, `room-change-log.ts`). `write_memory` writes canvas
 * memory (#902) through `lib/canvas/memory.ts`.
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

/** What the Coordinator sees of a Terminal Tab: never its scrollback. */
export type TerminalTabSummary = {
  id: string
  label: string
  /** The Branch (Workspace) the terminal runs against. */
  branchId: string
}

/**
 * MCP annotations for the Coordinator's tools, by tool name, sent when a
 * desktop harness lists them (#903). Codex runs an MCP tool without asking
 * only when it is `readOnlyHint`, or both `destructiveHint: false` and
 * `openWorldHint: false`, so give each new tool the honest hints here.
 */
export const ROOM_TOOL_ANNOTATIONS: Readonly<
  Record<string, McpToolAnnotations>
> = {
  read_canvas: { readOnlyHint: true, openWorldHint: false },
  // Workspace reads (`room-read-tools.ts`).
  read_workspace_chat: { readOnlyHint: true, openWorldHint: false },
  read_workspace_diff: { readOnlyHint: true, openWorldHint: false },
  read_workspace_file: { readOnlyHint: true, openWorldHint: false },
  view_frame: { readOnlyHint: true, openWorldHint: false },
  // Writes only canvas memory (#902), which the spec lets act right away.
  write_memory: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  // Starts a turn in a Workspace chat the user can see and take over.
  send_to_workspace: { destructiveHint: false, openWorldHint: false },
  // Creates Workspaces only after the user approves the plan (#898).
  create_workspaces: { destructiveHint: false, openWorldHint: false },
  // Stops a turn the user can resume by messaging the Workspace again.
  stop_workspace: { destructiveHint: false, openWorldHint: false },
  // Act only after the user confirms (#901): a PR on GitHub, and a removal
  // that tears the sandbox down for good.
  open_pull_request: { destructiveHint: false, openWorldHint: true },
  remove_workspace: { destructiveHint: true, openWorldHint: false },
  // Reads a bundled Coordinator App Skill (#905).
  read_skill: { readOnlyHint: true, openWorldHint: false },
  // Shared by every chat's toolset (`layer-read-tools.ts`).
  read_document: { readOnlyHint: true, openWorldHint: false },
  // Arrange tools (`room-arrange-tools.ts`): canvas-only writes, every one
  // undoable with `undo_changes`, so none is destructive.
  create_frames: { destructiveHint: false, openWorldHint: false },
  create_document: { destructiveHint: false, openWorldHint: false },
  move_group: { destructiveHint: false, openWorldHint: false },
  arrange_groups: { destructiveHint: false, openWorldHint: false },
  move_to_group: { destructiveHint: false, openWorldHint: false },
  merge_groups: { destructiveHint: false, openWorldHint: false },
  rename: { destructiveHint: false, openWorldHint: false },
  remove: { destructiveHint: false, openWorldHint: false },
  undo_changes: { destructiveHint: false, openWorldHint: false },
  list_changes: { readOnlyHint: true, openWorldHint: false },
  // Moves only the asker's own view (`room-view-tools.ts`).
  show_on_canvas: { readOnlyHint: true, openWorldHint: false },
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
  return {
    ...buildArrangeTools(ports.mutateDoc, turnId),
    ...buildViewTools(ports.readDoc),
    read_canvas: tool({
      description:
        "Read a compact summary of the whole canvas: its repositories, Workspaces (title, branch, status, changed lines, PR), Groups (name, position, what they hold), frames (label, route, size, Workspace), documents and Terminal Tabs. Call it before answering anything about what is on the canvas; ids in the result are what other tools take.",
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
    ...buildWorkspaceReadTools(ports),
    write_memory: tool({
      description: `Add, edit or remove an entry of canvas memory: the preferences, decisions and facts about the repositories that every chat on this canvas reads in its system prompt. Add one short, self-contained sentence per entry (at most ${MEMORY_ENTRY_MAX_LENGTH} characters). Edit or remove by the id shown in brackets in the Canvas memory block of your prompt. Never save secrets or credentials.`,
      inputSchema: jsonSchema<WriteMemoryInput>({
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "edit", "remove"] },
          id: {
            type: "string",
            description: "The entry to edit or remove. Not used for add.",
          },
          text: {
            type: "string",
            description: "The entry's text, for add and edit.",
          },
        },
        required: ["action"],
      }),
      execute: async (input) => writeMemory(ports, input),
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
    [CREATE_WORKSPACES_TOOL]: withPlanGate(
      tool({
        description:
          "Create Workspaces, each seeded with a first message for its agent. Use it when the user asks for work no existing Workspace fits; send follow-ups to an existing Workspace with `send_to_workspace` instead. The call shows the user a plan with one row per Workspace (title, repository, brief) and creates nothing until they approve it; you hear the result in the next turn. There's no limit on how many you list, but propose only what the ask needs.",
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
                  brief: {
                    type: "string",
                    description:
                      "One line for the plan saying what the Workspace will do.",
                  },
                  prompt: {
                    type: "string",
                    description:
                      "The seed message its agent starts on, written as the user would write it.",
                  },
                },
                required: ["title", "repository", "brief", "prompt"],
              },
            },
          },
          required: ["workspaces"],
        }),
      }),
      (input) => workspacePlan(ports, input as CreateWorkspacesInput)
    ),
    [OPEN_PULL_REQUEST_TOOL]: withPlanGate(
      tool({
        description:
          "Open a pull request on GitHub for a Workspace's branch, into its repository's default branch. The user sees a confirm card and nothing happens until they click Open PR; you hear the result in the next turn. It's opened with the GitHub account of the Workspace's owner. Its title and description come from the branch's commits, so make sure the Workspace's agent has committed and pushed first.",
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
      }),
      (input) => openPullRequestGate(ports, input as { workspace_id?: string })
    ),
    [REMOVE_WORKSPACE_TOOL]: withPlanGate(
      tool({
        description:
          "Remove a Workspace from the canvas, as Delete in the Workspaces menu does: its chats and frames go and its sandbox is torn down, which can't be undone. The git branch and any PR stay on GitHub. The user sees a confirm card and nothing happens until they click Remove; you hear the result in the next turn.",
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
      }),
      (input) => removeWorkspaceGate(ports, input as { workspace_id?: string })
    ),
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
    read_skill: tool({
      // The index rides in the description too, so a desktop harness, which
      // gets the tools but not our system prompt, still finds the Skills.
      description: `Load the full instructions for one of your skills. Call it before acting when a request matches a skill's description. Skills:\n${coordinatorSkillListing()}`,
      inputSchema: jsonSchema<{ name: string }>({
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      }),
      execute: async ({ name }) =>
        getSkill(name, "coordinator") ??
        `Unknown skill: "${name}". Available skills:\n${coordinatorSkillListing()}`,
    }),
  }
}

/** The Coordinator's App Skills (#905), one `- name: description` line each. */
function coordinatorSkillListing(): string {
  return getSkillIndex("coordinator")
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n")
}

/** One Workspace in a `create_workspaces` call, as the model writes it. */
export type WorkspaceSpec = {
  title: string
  repository: string
  base_branch?: string
  brief: string
  prompt: string
}

type CreateWorkspacesInput = { workspaces: WorkspaceSpec[] }

/**
 * What a `create_workspaces` plan keeps for its approval: the Workspaces as
 * the plan showed them, and who they will belong to.
 */
export type WorkspacePlanInput = {
  gate: typeof CREATE_WORKSPACES_TOOL
  workspaces: WorkspaceSpec[]
  requesterId: string
}

/** Whether a pending plan's stored input is a `create_workspaces` plan. */
export function isWorkspacePlanInput(
  input: Record<string, unknown>
): input is WorkspacePlanInput {
  return (
    input.gate === CREATE_WORKSPACES_TOOL && Array.isArray(input.workspaces)
  )
}

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

/**
 * The plan review `create_workspaces` raises: one row per Workspace with its
 * title, repository and brief, and the base branch when it isn't the default.
 * Never throws, so a doc read failing still shows the user a plan.
 */
async function workspacePlan(
  ports: RoomToolPorts,
  input: CreateWorkspacesInput
): Promise<PlanGateRequest> {
  const workspaces = (input?.workspaces ?? []).map(cleanSpec)
  const repos = await ports
    .readDoc((c) => records<RepoData>(c, COLLECTION_KEYS.repos))
    .catch(() => [] as RepoData[])
  const rows = workspaces.map((w) => {
    const repo = findRepo(repos, w.repository)
    const where = repo
      ? repo.repoFullName +
        (w.base_branch && w.base_branch !== repo.defaultBranch
          ? ` from ${w.base_branch}`
          : "")
      : `${w.repository} (not on this canvas, so it can't be created)`
    return { title: w.title, where, brief: w.brief }
  })
  const plan = workspacePlanMarkdown(rows)
  return {
    plan,
    input: {
      gate: CREATE_WORKSPACES_TOOL,
      workspaces,
      requesterId: ports.requesterId,
    },
  }
}

function cleanSpec(raw: WorkspaceSpec): WorkspaceSpec {
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const base = text(raw?.base_branch)
  return {
    title: text(raw?.title),
    repository: text(raw?.repository),
    ...(base ? { base_branch: base } : {}),
    brief: text(raw?.brief),
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
 * Create the Workspaces of an approved `create_workspaces` plan (#898), each
 * owned by the plan's requester and seeded with its prompt once its sandbox
 * runs. Every Workspace is created before any is provisioned, together in one
 * new Group of frames; a Workspace that fails to start is marked failed (its
 * row offers Retry) and the rest carry on. Returns the tool result the
 * Coordinator reads, naming each Workspace so its task row shows.
 */
export async function createWorkspaces(
  ports: RoomToolPorts,
  plan: WorkspacePlanInput
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
      for (const spec of plan.workspaces.map(cleanSpec)) {
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
            port: repo.devServerPort ?? 3000,
            status: "creating",
            statusMessage: "Creating branch…",
            createdAt: Date.now(),
            // Titled up front, so the seed message mustn't rename the branch.
            autoNamedBranch: false,
            createFlow: flow,
            ...(flow === "duplicate-branch"
              ? { createSourceBranch: base }
              : {}),
            createdBy: plan.requesterId,
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

/**
 * The Workspace a confirm gate acts on, or the refusal when there is none.
 * Reads the raw map, never a cached collection snapshot.
 */
async function confirmTarget(
  ports: RoomToolPorts,
  workspaceId: unknown
): Promise<
  | {
      branch: BranchData
      repo: RepoData | undefined
      chats: number
      frames: number
    }
  | PlanGateRefusal
> {
  const id = typeof workspaceId === "string" ? workspaceId.trim() : ""
  const found = await ports
    .readDoc((c) => {
      const branch = records<BranchData>(c, COLLECTION_KEYS.branches).find(
        (b) => b.id === id
      )
      if (!branch) return null
      return {
        branch,
        repo: records<RepoData>(c, COLLECTION_KEYS.repos).find(
          (r) => r.id === branch.repoId
        ),
        chats: records<ChatSessionData>(c, COLLECTION_KEYS.chatSessions).filter(
          (chat) => chat.branchId === id
        ).length,
        frames: records<IframeLayerData>(
          c,
          COLLECTION_KEYS.iframeLayers
        ).filter((f) => f.branchId === id).length,
      }
    })
    .catch(() => null)
  return (
    found ?? {
      refusal: `No Workspace has the id ${id || "(none)"}. Call read_canvas for current ids.`,
    }
  )
}

function confirmRequest(
  card: ConfirmCard,
  workspaceId: string,
  ports: RoomToolPorts
): PlanGateRequest {
  const input: ConfirmGateInput = {
    gate: card.action,
    confirm: card,
    workspaceId,
    requesterId: ports.requesterId,
  }
  // The plan text is what the card falls back to, and what the model and a
  // reload read beside the card.
  return { plan: `**${card.title}**\n\n${card.description}`, input }
}

/** A Workspace's open PR, if it has one. */
function openPr(branch: BranchData): number | null {
  return branch.prNumber && (branch.prState ?? "open") === "open"
    ? branch.prNumber
    : null
}

/**
 * The confirm card `open_pull_request` raises (#901): the branch into the
 * repository's default branch, with the changed lines.
 */
async function openPullRequestGate(
  ports: RoomToolPorts,
  input: { workspace_id?: string }
): Promise<PlanGateRequest | PlanGateRefusal> {
  const target = await confirmTarget(ports, input?.workspace_id)
  if ("refusal" in target) return target
  const { branch, repo } = target
  const title = workspaceLabel(branch)
  const pr = openPr(branch)
  if (pr) return { refusal: `"${title}" already has PR #${pr} open.` }
  if (!repo || !hasGitHubRemote(repo)) {
    return {
      refusal: `"${title}" isn't in a GitHub repository, so it can't have a pull request.`,
    }
  }
  const lines = lineCounts(branch)
  return confirmRequest(
    {
      action: OPEN_PULL_REQUEST_TOOL,
      title: `Open a pull request for ${title}?`,
      description: `From \`${branch.ref}\` into \`${repo.defaultBranch}\`${lines ? `, ${lines}` : ""}.`,
      confirmLabel: "Open PR",
    },
    branch.id,
    ports
  )
}

/**
 * The confirm card `remove_workspace` raises (#901): what goes, in the delete
 * dialog's words, and the PR that stays.
 */
async function removeWorkspaceGate(
  ports: RoomToolPorts,
  input: { workspace_id?: string }
): Promise<PlanGateRequest | PlanGateRefusal> {
  const target = await confirmTarget(ports, input?.workspace_id)
  if ("refusal" in target) return target
  const { branch, chats, frames } = target
  const removes = [
    chats > 0 && plural(chats, "chat"),
    frames > 0 && plural(frames, "frame"),
    "its sandbox",
  ].filter((f): f is string => Boolean(f))
  const pr = openPr(branch)
  return confirmRequest(
    {
      action: REMOVE_WORKSPACE_TOOL,
      title: `Remove ${workspaceLabel(branch)}?`,
      description: `Removes ${joinFacts(removes)}.${pr ? ` Keeps PR #${pr}.` : ""}`,
      confirmLabel: "Remove",
    },
    branch.id,
    ports
  )
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`
}

function joinFacts(facts: string[]): string {
  if (facts.length <= 1) return facts[0] ?? ""
  return `${facts.slice(0, -1).join(", ")} and ${facts[facts.length - 1]}`
}

/**
 * Act on a confirm the user decided (#901) and return the tool result the
 * Coordinator reads. A cancel does nothing. The Workspace is read again, since
 * it may have changed while the card waited.
 */
export async function settleConfirm(
  ports: RoomToolPorts,
  gate: ConfirmGateInput,
  approved: boolean
): Promise<string> {
  if (!approved) return confirmCancelledResult()
  return gate.gate === OPEN_PULL_REQUEST_TOOL
    ? openPullRequest(ports, gate)
    : removeWorkspace(ports, gate)
}

/**
 * Open the Workspace's PR with its owner's GitHub account (#890: the
 * Coordinator acts as each Workspace's owner, whoever confirms), then record
 * it on the Workspace so its row and badge show it now.
 */
async function openPullRequest(
  ports: RoomToolPorts,
  gate: ConfirmGateInput
): Promise<string> {
  const branch = await ports.readDoc(({ branches }) =>
    branches.get(gate.workspaceId)
  )
  if (!branch) throw new Error("Not opened: the Workspace is gone.")
  const title = workspaceLabel(branch)
  const existing = openPr(branch)
  if (existing) return `"${title}" already has PR #${existing} open.`
  const requester =
    typeof gate.requesterId === "string" ? gate.requesterId : ports.requesterId
  const { url, number } = await ports.openPullRequest({
    sandboxName: branch.sandboxName,
    ownerId: workspaceOwnerId(branch, requester),
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
 * Remove the Workspace the way Delete in the Workspaces menu does: the Branch, its
 * frames and chats leave the doc in one change, then its sandbox is torn
 * down. The git branch stays wherever it is.
 */
async function removeWorkspace(
  ports: RoomToolPorts,
  gate: ConfirmGateInput
): Promise<string> {
  const removed = await ports.mutateDoc((collections) => {
    const branch = collections.branches.get(gate.workspaceId)
    if (!branch) return null
    createCanvasOps(createRoomCollections(collections.doc)).removeBranch(
      branch.id
    )
    return branch
  })
  if (!removed) return "Already removed: the Workspace was gone."
  if (removed.sandboxName) {
    await ports.deleteSandbox(removed.sandboxName).catch(() => {})
  }
  return `Removed "${workspaceLabel(removed)}" and tore down its sandbox.`
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

type WriteMemoryInput = {
  action: "add" | "edit" | "remove"
  id?: string
  text?: string
}

async function writeMemory(
  ports: RoomToolPorts,
  { action, id, text }: WriteMemoryInput
): Promise<string> {
  if (action === "add") {
    if (!text?.trim()) return "Nothing saved: an entry needs text."
    const entry = await ports.mutateDoc((c) =>
      addMemory(c, { text, source: "coordinator" })
    )
    return entry ? `Saved [${entry.id}] ${entry.text}` : "Nothing saved."
  }
  if (!id) return `Nothing changed: ${action} needs the entry's id.`
  if (action === "edit") {
    if (!text?.trim()) return "Nothing changed: an edit needs text."
    const edited = await ports.mutateDoc((c) => editMemory(c, id, { text }))
    return edited ? `Updated [${id}].` : `No memory entry [${id}].`
  }
  const removed = await ports.mutateDoc((c) => removeMemory(c, id))
  return removed ? `Removed [${id}].` : `No memory entry [${id}].`
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
    // A fresh Workspace still starting (the one adding a repository makes,
    // #1182) takes the message as its seed, sent once its sandbox runs.
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
    const branchChats = chats.filter((c) => c.branchId === branchId)
    const open = branchChats
      .filter((c) => !c.closedAt)
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    let target: {
      chatId: string
      model: string | undefined
      isFirstChat: boolean
    }
    if (open) {
      target = {
        chatId: open.id,
        model: open.model,
        isFirstChat: branchChats.length === 1,
      }
    } else {
      const chat: ChatSessionData = {
        id: nanoid(),
        branchId,
        label: "Untitled",
        createdAt: Date.now(),
      }
      collections.chatSessions.set(chat.id, chat)
      target = {
        chatId: chat.id,
        model: undefined,
        isFirstChat: branchChats.length === 0,
      }
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
 * Per-section caps on the canvas summary. A canvas past them gets a "…and N
 * more" line, so the summary stays well under 25k tokens however big the
 * canvas grows (the size test pins this).
 */
export const CANVAS_SUMMARY_LIMITS = {
  repos: 20,
  workspaces: 100,
  groups: 100,
  frames: 150,
  documents: 100,
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
  const chats = records<ChatSessionData>(
    collections,
    COLLECTION_KEYS.chatSessions
  )

  const groupOf = new Map(
    groups.flatMap((g) => getGroupMembers(g).map((m) => [m.id, g.id] as const))
  )
  const repoNames = new Map(repos.map((r) => [r.id, r.repoFullName]))
  const working = new Set(
    chats.filter((c) => c.branchId && c.isStreaming).map((c) => c.branchId)
  )
  const byCreated = <T extends { createdAt?: number }>(a: T, b: T) =>
    (a.createdAt ?? 0) - (b.createdAt ?? 0)

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
    section("Groups", groups, CANVAS_SUMMARY_LIMITS.groups, (g) =>
      [
        `- [${g.id}] "${clip(g.name ?? "Group")}"`,
        `at ${Math.round(g.x)}, ${Math.round(g.y)}`,
        // Its extent, so a move can clear its neighbours (items sit in one
        // row, left to right, the Group's gap apart).
        `${Math.round(groupContentWidth(g, frames, documents))}×${Math.round(groupContentHeight(g, frames, documents))}`,
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
