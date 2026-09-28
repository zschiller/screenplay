import "server-only"

import { tool, jsonSchema, type ToolSet } from "ai"
import { nanoid } from "nanoid"
import { buildArrangeTools } from "@/lib/agent/room-arrange-tools"
import { getGroupMembers } from "@/lib/canvas/layout"
import { COLLECTION_KEYS, type RoomCollections } from "@/lib/yjs/schema"
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
import type {
  BranchData,
  ChatSessionData,
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
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
  // Shared by every chat's toolset (`layer-read-tools.ts`).
  read_document: { readOnlyHint: true, openWorldHint: false },
  // Arrange tools (`room-arrange-tools.ts`): canvas-only writes, every one
  // undoable with `undo_changes`, so none is destructive.
  create_frames: { destructiveHint: false, openWorldHint: false },
  create_document: { destructiveHint: false, openWorldHint: false },
  move_group: { destructiveHint: false, openWorldHint: false },
  move_to_group: { destructiveHint: false, openWorldHint: false },
  merge_groups: { destructiveHint: false, openWorldHint: false },
  rename: { destructiveHint: false, openWorldHint: false },
  remove: { destructiveHint: false, openWorldHint: false },
  undo_changes: { destructiveHint: false, openWorldHint: false },
  list_changes: { readOnlyHint: true, openWorldHint: false },
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
  }
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
