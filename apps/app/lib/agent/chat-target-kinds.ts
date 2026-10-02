import "server-only"

import type { ModelMessage, Tool } from "ai"
import {
  buildAgentSystemPrompt,
  buildRoomSystemPrompt,
  type LayerDirectory,
} from "./config"
import { toolsetFor } from "./toolset"
import type { ToolNaming } from "./tool-name"
import { prependTurnMarkers } from "./message-markers"
import type { ToolContext } from "./tools"
import { summarizeCanvas, type RoomToolPorts } from "./room-tools"
import { liveWorkspaceReadPorts } from "./room-read-ports"
import { listTerminalTabs } from "@/lib/terminal-tabs"
import { getMergedSkillIndexForSandbox } from "@/lib/skills/sandbox-index"
import { getSkillIndex } from "@/lib/skills"
import type { OriginTaggedSkill } from "@/lib/skills/merged"
import type { RoomDoc, RoomReader } from "@/lib/room-access"
import { readMemory } from "@/lib/canvas/memory"
import type { MemoryData } from "@/lib/types"

/**
 * Server-side registry of chat target kinds (a Branch's sandbox or the whole
 * Room). A Document is no longer a target (#1314): a Workspace chat writes the
 * Documents it owns with its own tools. Each entry contains the
 * code paths that change between targets:
 *
 *   - `loadContext` reads the live state of the target from Yjs.
 *   - `buildSystemPrompt` turns that state into a system prompt.
 *   - `buildTools` returns the AI-SDK tool object the agent loop runs with.
 *   - `decoratePrompt` lets the kind pre-process the user message (e.g.
 *     prepend a `[plan mode: enabled]` flag for sandbox chats).
 *
 * Every chat target's toolset includes the cross-cutting `read_document`
 * tool (via `buildLayerReadTools`) so the model can follow `@<title>`
 * mentions to peer layers, regardless of which kind is being targeted.
 *
 * `/api/agent/stream` looks up the right entry by `target.kind` and drives the
 * Engine seam against whatever toolset the entry returns.
 */
export interface ChatTargetSpec<TTarget, TContext> {
  kind: string
  loadContext(room: RoomDoc, target: TTarget): Promise<TContext | null>
  buildSystemPrompt(
    ctx: TContext,
    opts: { repoSystemPrompt?: string; toolNaming?: ToolNaming }
  ): string
  buildTools(
    room: RoomDoc,
    target: TTarget,
    sandbox?: ToolContext
  ): Record<string, Tool>
  decorateUserMessage?(
    message: string,
    opts: {
      planMode?: boolean
      branch?: string
      isFirstMessage: boolean
      /** The Coordinator chat that sent this turn, for a Delegated Message. */
      delegatedFrom?: string
    }
  ): string
}

/**
 * Canvas memory (#902) for a system prompt. Every kind reads it; a read that
 * fails leaves the prompt without memory rather than failing the turn.
 */
export async function loadCanvasMemory(
  room: RoomReader
): Promise<MemoryData[]> {
  return (await room.readDoc(readMemory).catch(() => null)) ?? []
}

/**
 * Snapshot the canvas's docs for the model's directory block. Cheap — the
 * collection is already in memory; we copy id, title and owning chat only.
 */
export async function loadLayerDirectory(
  room: RoomDoc
): Promise<LayerDirectory> {
  return (
    (await room
      .readDoc(({ markdownLayers }) => ({
        documents: markdownLayers.toArray().map((d) => ({
          id: d.id,
          title: d.title,
          ...(d.ownerChatId ? { ownerChatId: d.ownerChatId } : {}),
        })),
      }))
      .catch(() => null)) ?? { documents: [] }
  )
}

// ---------------------------------------------------------------------------
// Agent (sandbox-backed) target — existing flow.
// ---------------------------------------------------------------------------

export interface AgentTarget {
  sandboxName: string
  branch: string
  agentId?: string
  /** The chat, which owns the Documents it makes (#1314). */
  chatId: string
}

interface AgentContext {
  chatId: string
  repoSystemPrompt: string | undefined
  layerDirectory: LayerDirectory
  /** Merged App ∪ Repo Skill index, enumerated once from this Branch's sandbox. */
  skills: OriginTaggedSkill[]
  memory: MemoryData[]
}

export const agentChatTarget: ChatTargetSpec<AgentTarget, AgentContext> = {
  kind: "agent",
  async loadContext(room, target) {
    const [repoSystemPrompt, layerDirectory, skills, memory] =
      await Promise.all([
        room
          .readDoc(({ branches, repos }) => {
            const branch = branches
              .toArray()
              .find((a) => a.sandboxName === target.sandboxName)
            if (!branch) return undefined
            return repos.get(branch.repoId)?.systemPrompt
          })
          .catch(() => undefined),
        loadLayerDirectory(room),
        getMergedSkillIndexForSandbox(target.sandboxName),
        loadCanvasMemory(room),
      ])
    return {
      chatId: target.chatId,
      repoSystemPrompt,
      layerDirectory,
      skills,
      memory,
    }
  },
  buildSystemPrompt(ctx, { toolNaming }) {
    return buildAgentSystemPrompt({
      repoSystemPrompt: ctx.repoSystemPrompt ?? undefined,
      layerDirectory: ctx.layerDirectory,
      chatId: ctx.chatId,
      skills: ctx.skills,
      memory: ctx.memory,
      toolNaming,
    })
  },
  buildTools(room, target, sandbox) {
    if (!sandbox) {
      throw new Error("agent chat target requires a sandbox ToolContext")
    }
    return toolsetFor({ kind: "sandbox", room, sandbox, chatId: target.chatId })
  },
  decorateUserMessage(
    message,
    { planMode, branch, isFirstMessage, delegatedFrom }
  ) {
    // Policy lives here (branch only on the first message); the codec owns
    // the format.
    return prependTurnMarkers(message, {
      planMode,
      branch: isFirstMessage ? branch : undefined,
      delegatedFrom,
    })
  },
}

// ---------------------------------------------------------------------------
// Room target — the whole canvas (the Coordinator). No sandbox:
// its tools come from the Coordinator tools module (`room-tools.ts`).
// ---------------------------------------------------------------------------

export interface RoomTarget {
  /** The member whose message this turn answers (Terminal Tabs are per user). */
  userId: string
  /**
   * The turn canvas changes are logged under for undo. Omitted, each tool set
   * built is its own turn; the desktop MCP route builds one per request, so it
   * passes the chat's running turn instead.
   */
  turnId?: string
  /**
   * Starts a Workspace turn for `send_to_workspace`. Turn Launch lives above
   * this module (`turn-launch-live.ts`), so the Room turn injects it; without
   * it the tool reports that it can't reach Workspaces.
   */
  launchWorkspaceTurn?: RoomToolPorts["launchWorkspaceTurn"]
  /** Provisions a Workspace `create_workspaces` created, injected likewise. */
  provisionWorkspace?: RoomToolPorts["provisionWorkspace"]
  /** Stops a Workspace chat's turn for `stop_workspace`, injected likewise. */
  stopWorkspaceTurn?: RoomToolPorts["stopWorkspaceTurn"]
  /** Opens a Workspace's PR once the user confirms (#901), injected likewise. */
  openPullRequest?: RoomToolPorts["openPullRequest"]
  /** Tears down a removed Workspace's sandbox (#901), injected likewise. */
  deleteSandbox?: RoomToolPorts["deleteSandbox"]
  /** The Coordinator chat. */
  coordinatorChatId?: string
  /**
   * Who owns the Workspaces this turn creates, when not `userId`: on a wake
   * turn, the owner of the Workspace that woke it (`wakeRequesterId`).
   */
  requesterId?: string
  /**
   * False on a canvas with no repository (`roomHasRepository`): there are no
   * Workspaces, so the Coordinator writes Documents and Mockups itself.
   * Defaults to true, where it only delegates.
   */
  hasRepository?: boolean
}

interface RoomContext {
  canvasSummary: string
  memory: MemoryData[]
  /** False on a canvas with no repository: the Coordinator makes Documents and Mockups itself. */
  hasRepository?: boolean
}

/** The Coordinator tools module's ports over the live Room doc and database. */
export function liveRoomToolPorts(
  room: RoomDoc,
  {
    userId,
    launchWorkspaceTurn,
    provisionWorkspace,
    stopWorkspaceTurn,
    openPullRequest,
    deleteSandbox,
    coordinatorChatId,
    requesterId,
  }: RoomTarget
): RoomToolPorts {
  const unavailable = (what: string) => async (): Promise<never> => {
    throw new Error(`${what} isn't available here.`)
  }
  return {
    ...liveWorkspaceReadPorts(room.roomId),
    readDoc: (fn) => room.readDoc(fn),
    mutateDoc: (fn) => room.mutateDoc(fn),
    launchWorkspaceTurn:
      launchWorkspaceTurn ?? unavailable("Messaging Workspaces"),
    provisionWorkspace:
      provisionWorkspace ?? unavailable("Starting Workspaces"),
    stopWorkspaceTurn: stopWorkspaceTurn ?? unavailable("Stopping Workspaces"),
    openPullRequest: openPullRequest ?? unavailable("Opening pull requests"),
    deleteSandbox: deleteSandbox ?? unavailable("Removing Workspaces"),
    requesterId: requesterId ?? userId,
    coordinatorChatId: coordinatorChatId ?? "",
    listTerminalTabs: async () =>
      (await listTerminalTabs({ userId, roomId: room.roomId })).map((t) => ({
        id: t.id,
        label: t.label,
        branchId: t.branch,
      })),
  }
}

export const roomChatTarget: ChatTargetSpec<RoomTarget, RoomContext> = {
  kind: "room",
  async loadContext(room, target) {
    const ports = liveRoomToolPorts(room, target)
    const terminalTabs = await ports.listTerminalTabs().catch(() => [])
    const [canvasSummary, memory] = await Promise.all([
      ports.readDoc((collections) =>
        summarizeCanvas(collections, terminalTabs)
      ),
      loadCanvasMemory(room),
    ])
    return { canvasSummary, memory, hasRepository: target.hasRepository }
  },
  buildSystemPrompt(ctx, { toolNaming }) {
    return buildRoomSystemPrompt({
      canvasSummary: ctx.canvasSummary,
      memory: ctx.memory,
      hasRepository: ctx.hasRepository,
      skills: getSkillIndex("coordinator"),
      toolNaming,
    })
  },
  buildTools(room, target) {
    return toolsetFor({
      kind: "room",
      room,
      ports: liveRoomToolPorts(room, target),
      turnId: target.turnId,
      hasRepository: target.hasRepository,
    })
  },
  // No turn markers: there is no branch, and plan mode belongs to sandbox
  // chats (#743), so a stale `planMode: true` never reaches the model.
  decorateUserMessage(message) {
    return message
  },
}

/** A loaded chat target — produced by `prepareChatTarget` for the route. */
export type PreparedChatTarget = {
  kind: string
  systemPrompt: string
  tools: Record<string, Tool>
  decorateUserMessage: (
    message: string,
    opts: {
      planMode?: boolean
      branch?: string
      isFirstMessage: boolean
      /** The Coordinator chat that sent this turn, for a Delegated Message. */
      delegatedFrom?: string
    }
  ) => string
}

/**
 * One-shot helper: pick the spec, load its context, build prompt + tools.
 * Returns `null` when the target can't be resolved so the caller can return
 * a 404 cleanly. `toolNaming` names the
 * target's tools the way the turn's engine exposes them (#1223).
 */
export async function prepareChatTarget<TTarget, TContext>(
  room: RoomDoc,
  spec: ChatTargetSpec<TTarget, TContext>,
  target: TTarget,
  toolCtx?: ToolContext,
  opts: { toolNaming?: ToolNaming } = {}
): Promise<PreparedChatTarget | null> {
  const ctx = await spec.loadContext(room, target)
  if (!ctx) return null
  return {
    kind: spec.kind,
    systemPrompt: spec.buildSystemPrompt(ctx, { toolNaming: opts.toolNaming }),
    tools: spec.buildTools(room, target, toolCtx),
    decorateUserMessage: (message, opts) =>
      spec.decorateUserMessage?.(message, opts) ?? message,
  }
}

// Re-export used types so the route doesn't need to import them from the
// AI SDK directly.
export type { ModelMessage }
