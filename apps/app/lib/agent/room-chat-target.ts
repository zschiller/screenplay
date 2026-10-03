import "server-only"

import { buildRoomSystemPrompt } from "./config"
import { loadCanvasMemory, type ChatTargetSpec } from "./chat-target-kinds"
import {
  buildRoomTools,
  summarizeCanvas,
  type RoomToolPorts,
} from "./room-tools"
import { liveWorkspaceReadPorts } from "./room-read-ports"
import { buildLayerReadTools } from "./layer-read-tools"
import { buildQuestionTools } from "./question-tools"
import { listTerminalTabs } from "@/lib/terminal-tabs"
import { getSkillIndex } from "@/lib/skills"
import type { RoomDoc } from "@/lib/room-access"
import { buildFileTools } from "./file-tools"
import { canvasFiles } from "@/lib/files"
import { loadCanvasFiles } from "@/lib/files/canvas-files"
import type { FileEntryData, MemoryData } from "@/lib/types"

/** The Room Target: the whole canvas, for the Coordinator. */
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
  /** Starts a turn in a chat with no repository, injected likewise. */
  launchSketchTurn?: RoomToolPorts["launchSketchTurn"]
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
}

export interface RoomContext {
  canvasSummary: string
  memory: MemoryData[]
  files: FileEntryData[]
}

/** The Coordinator tools module's ports over the live Room doc and database. */
export function liveRoomToolPorts(
  room: RoomDoc,
  {
    userId,
    launchWorkspaceTurn,
    launchSketchTurn,
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
    launchWorkspaceTurn: launchWorkspaceTurn ?? unavailable("Messaging chats"),
    launchSketchTurn: launchSketchTurn ?? unavailable("Messaging chats"),
    provisionWorkspace: provisionWorkspace ?? unavailable("Starting chats"),
    stopWorkspaceTurn: stopWorkspaceTurn ?? unavailable("Stopping chats"),
    openPullRequest: openPullRequest ?? unavailable("Opening pull requests"),
    deleteSandbox: deleteSandbox ?? unavailable("Deleting chats"),
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

/** No sandbox: its tools come from the Coordinator tools module. */
export const roomChatTarget: ChatTargetSpec<RoomTarget, RoomContext> = {
  kind: "room",
  async loadContext(room, target) {
    const ports = liveRoomToolPorts(room, target)
    const terminalTabs = await ports.listTerminalTabs().catch(() => [])
    const [canvasSummary, memory, files] = await Promise.all([
      ports.readDoc((collections) =>
        summarizeCanvas(collections, terminalTabs)
      ),
      loadCanvasMemory(room),
      loadCanvasFiles(room),
    ])
    return { canvasSummary, memory, files }
  },
  buildSystemPrompt(ctx, naming) {
    return buildRoomSystemPrompt({
      canvasSummary: ctx.canvasSummary,
      memory: ctx.memory,
      files: ctx.files,
      skills: getSkillIndex("coordinator"),
      toolNaming: naming,
    })
  },
  tools(room, target) {
    return {
      shared: {
        ...buildRoomTools(
          room.roomId,
          liveRoomToolPorts(room, target),
          target.turnId
        ),
        ...buildLayerReadTools({ room }),
        ...buildQuestionTools(),
        // The canvas's saved files (#1514): text only, with no sandbox.
        ...buildFileTools({
          canvas: canvasFiles(room),
          chatId: target.coordinatorChatId ?? "",
        }),
      },
    }
  },
  // No turn markers: there is no branch, and plan mode belongs to Workspace
  // chats (#743), so a stale `planMode: true` never reaches the model.
  decorateUserMessage(message) {
    return message
  },
}
