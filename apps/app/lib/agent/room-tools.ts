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
 * The in-process engine's tool set calls it today; the desktop MCP server will
 * call the same function, so each tool is defined once.
 *
 * It takes a Room id plus {@link RoomToolPorts}: the things it drives, injected
 * so tests run every tool against a bare Room doc. Tools that change the canvas
 * write through Canvas Operations inside `mutateDoc` (a server-side room
 * mutation, ADR 0001), logged per turn so the Coordinator can undo a turn when
 * asked (`room-arrange-tools.ts`, `room-change-log.ts`).
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
  }
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
