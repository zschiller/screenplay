import { tool, jsonSchema, type ToolSet } from "ai"
import type * as Y from "yjs"
import { createCanvasOps, type CanvasOps } from "@/lib/canvas/ops"
import { getGroupMembers, placeNewIframeLayerGroup } from "@/lib/canvas/layout"
import {
  DEFAULT_IFRAME_LAYER_HEIGHT,
  DEFAULT_IFRAME_LAYER_WIDTH,
} from "@/lib/constants"
import { getIframeLayerSizePreset } from "@/lib/iframe-layer-sizes"
import { routeToLabel } from "@/lib/route-utils"
import { createRoomCollections, type RoomCollections } from "@/lib/yjs/schema"
import { listTurns, recordChange, undoTurn } from "@/lib/agent/room-change-log"
import type { RoomDoc } from "@/lib/room-access"
import type { BranchData } from "@/lib/types"
import { workspaceLabel } from "@/lib/workspace-label"

/** A new document's size, as a click with the Document tool makes it. */
const DOCUMENT_SIZE = { width: 480, height: 640 }

/**
 * The Coordinator's arrange tools (#894): create, move, group, merge, rename
 * and remove frames and documents, plus the change log's `list_changes` and
 * `undo_changes`. They act right away, with no confirmation. Every write goes
 * through Canvas Operations inside one server-side room mutation, logged
 * under `turnId` so the Coordinator can undo a turn when asked.
 */
export function buildArrangeTools(
  mutateDoc: RoomDoc["mutateDoc"],
  turnId: string
): ToolSet {
  /**
   * One logged write. Take Canvas Operations from `freshOps(doc)` for each
   * verb: nothing observes a server doc, so a cached collection view would
   * read stale after its first write.
   */
  const change = (fn: (doc: Y.Doc) => string) =>
    mutateDoc(({ doc }) => recordChange(doc, turnId, () => fn(doc)))

  return {
    create_frames: tool({
      description:
        "Create frames. With `workspace_id` and `routes`, one frame per route showing that Workspace, together in a new Group. With `workspace_id` alone, one frame for it. With neither, one blank frame. Pass `group_id` to add the frames to the end of an existing Group instead of a new one.",
      inputSchema: jsonSchema<{
        workspace_id?: string
        routes?: string[]
        group_id?: string
      }>({
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          routes: { type: "array", items: { type: "string" } },
          group_id: { type: "string" },
        },
      }),
      execute: async ({ workspace_id, routes = [], group_id }) =>
        change((doc) => {
          const { ops, c } = freshOps(doc)
          const branch = workspace_id ? c.branches.get(workspace_id) : undefined
          if (workspace_id && !branch) {
            return `Error: no Workspace ${workspace_id}.`
          }
          const frames = (routes.length ? routes : [undefined]).map(
            (route) => ({
              route,
              label: route ? routeToLabel(route) : "Frame",
            })
          )

          if (group_id) {
            const group = c.iframeLayerGroups.get(group_id)
            if (!group) return `Error: no Group ${group_id}.`
            const size = workspace_id
              ? workspaceFrameSize(c, workspace_id)
              : lastFrameSize(c, group_id)
            const ids = frames.map(
              (f) =>
                freshOps(doc).ops.addFrameToGroup(group_id, {
                  ...size,
                  label: f.label,
                  ...(workspace_id ? { branchId: workspace_id } : {}),
                  ...(f.route ? { route: f.route } : {}),
                })!
            )
            return withIds(
              `Added ${frameNames(frames)}${forWorkspace(branch)} to Group "${group.name ?? group_id}".`,
              ids
            )
          }

          if (!workspace_id) {
            const size = {
              width: DEFAULT_IFRAME_LAYER_WIDTH,
              height: DEFAULT_IFRAME_LAYER_HEIGHT,
            }
            const id = ops.createBlankFrame(newGroupAnchor(c, size), size)
            return withIds("Created a blank frame.", [id])
          }
          if (routes.length === 0) {
            const { layerId, groupId } = ops.createFrameForAgent(
              workspace_id,
              ORIGIN
            )
            return withIds(`Created a frame${forWorkspace(branch)}.`, [
              layerId,
              groupId,
            ])
          }
          const created = ops.createFramesForRoutes(
            workspace_id,
            frames.map((f) => ({ route: f.route!, label: f.label })),
            ORIGIN
          )!
          const group = freshOps(doc).c.iframeLayerGroups.get(created.groupId)
          const ids = group ? getGroupMembers(group).map((m) => m.id) : []
          return withIds(
            `Created ${frameNames(frames)}${forWorkspace(branch)} in a new Group.`,
            [...ids, created.groupId]
          )
        }),
    }),

    create_document: tool({
      description:
        "Create a document, optionally titled. Pass `group_id` to add it to the end of an existing Group; otherwise it gets a new Group.",
      inputSchema: jsonSchema<{ title?: string; group_id?: string }>({
        type: "object",
        properties: {
          title: { type: "string" },
          group_id: { type: "string" },
        },
      }),
      execute: async ({ title, group_id }) =>
        change((doc) => {
          const { ops, c } = freshOps(doc)
          let docId: string
          if (group_id) {
            const added = ops.addDocumentToGroup(group_id, DOCUMENT_SIZE)
            if (!added) return `Error: no Group ${group_id}.`
            docId = added.docId
          } else {
            docId = ops.createDocument(
              newGroupAnchor(c, DOCUMENT_SIZE),
              DOCUMENT_SIZE
            ).docId
          }
          if (title) freshOps(doc).ops.renameDocument(docId, title)
          return withIds(`Created document "${title || "Untitled"}".`, [docId])
        }),
    }),

    move_group: tool({
      description:
        "Move a Group (and everything in it) so its top-left corner is at canvas position `x`, `y`.",
      inputSchema: jsonSchema<{ group_id: string; x: number; y: number }>({
        type: "object",
        properties: {
          group_id: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["group_id", "x", "y"],
      }),
      execute: async ({ group_id, x, y }) =>
        change((doc) => {
          const { ops, c } = freshOps(doc)
          const group = c.iframeLayerGroups.get(group_id)
          if (!group) return `Error: no Group ${group_id}.`
          ops.patch("iframeLayerGroups", group_id, {
            x: Math.round(x),
            y: Math.round(y),
          })
          return `Moved Group "${group.name ?? group_id}" to ${Math.round(x)}, ${Math.round(y)}.`
        }),
    }),

    move_to_group: tool({
      description:
        "Move frames and documents, in the given order, into an existing Group at `index` (appended when omitted). Omit `group_id` to gather them into a new Group. A Group left empty is removed.",
      inputSchema: jsonSchema<{
        ids: string[]
        group_id?: string
        index?: number
      }>({
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "string" }, minItems: 1 },
          group_id: { type: "string" },
          index: { type: "integer", minimum: 0 },
        },
        required: ["ids"],
      }),
      execute: async ({ ids, group_id, index }) =>
        change((doc) => {
          const { ops, c } = freshOps(doc)
          const missing = ids.filter((id) => !memberGroup(c, id))
          if (missing.length) {
            return `Error: no frame or document ${missing.join(", ")} on the canvas.`
          }
          const names = memberNames(c, ids)
          if (!group_id) {
            const size = {
              width: DEFAULT_IFRAME_LAYER_WIDTH,
              height: DEFAULT_IFRAME_LAYER_HEIGHT,
            }
            const newId = ops.splitToNewGroup(ids, newGroupAnchor(c, size))
            return withIds(`Gathered ${names} into a new Group.`, [newId])
          }
          const target = c.iframeLayerGroups.get(group_id)
          if (!target) return `Error: no Group ${group_id}.`
          ids.forEach((id, i) =>
            freshOps(doc).ops.moveLayerToGroup(
              id,
              group_id,
              index === undefined ? undefined : index + i
            )
          )
          return `Moved ${names} into Group "${target.name ?? group_id}".`
        }),
    }),

    merge_groups: tool({
      description:
        "Merge one Group into another: the source's frames and documents are appended to the target's row and the source Group is removed.",
      inputSchema: jsonSchema<{
        source_group_id: string
        target_group_id: string
      }>({
        type: "object",
        properties: {
          source_group_id: { type: "string" },
          target_group_id: { type: "string" },
        },
        required: ["source_group_id", "target_group_id"],
      }),
      execute: async ({ source_group_id, target_group_id }) =>
        change((doc) => {
          const { ops, c } = freshOps(doc)
          const source = c.iframeLayerGroups.get(source_group_id)
          const target = c.iframeLayerGroups.get(target_group_id)
          if (!source) return `Error: no Group ${source_group_id}.`
          if (!target) return `Error: no Group ${target_group_id}.`
          ops.mergeGroups(source_group_id, target_group_id)
          return `Merged Group "${source.name ?? source_group_id}" into "${target.name ?? target_group_id}".`
        }),
    }),

    rename: tool({
      description: "Rename a frame, a Group or a document.",
      inputSchema: jsonSchema<{ id: string; name: string }>({
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string", minLength: 1 },
        },
        required: ["id", "name"],
      }),
      execute: async ({ id, name }) =>
        change((doc) => {
          const { ops, c } = freshOps(doc)
          const frame = c.iframeLayers.get(id)
          if (frame) {
            ops.patch("iframeLayers", id, { label: name })
            return `Renamed frame "${frame.label}" to "${name}".`
          }
          const group = c.iframeLayerGroups.get(id)
          if (group) {
            ops.patch("iframeLayerGroups", id, { name })
            return `Renamed Group "${group.name ?? id}" to "${name}".`
          }
          const document = c.markdownLayers.get(id)
          if (document) {
            ops.renameDocument(id, name)
            return `Renamed document "${document.title || "Untitled"}" to "${name}".`
          }
          return `Error: no frame, Group or document ${id}.`
        }),
    }),

    remove: tool({
      description:
        "Remove frames and documents. A Group left empty is removed with them. Removing a frame never touches its Workspace. Undo with `undo_changes`.",
      inputSchema: jsonSchema<{ ids: string[] }>({
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "string" }, minItems: 1 },
        },
        required: ["ids"],
      }),
      execute: async ({ ids }) =>
        change((doc) => {
          const { c } = freshOps(doc)
          const frames = ids.filter((id) => c.iframeLayers.has(id))
          const documents = ids.filter((id) => c.markdownLayers.has(id))
          const unknown = ids.filter(
            (id) => !frames.includes(id) && !documents.includes(id)
          )
          if (unknown.length) {
            return `Error: no frame or document ${unknown.join(", ")}. Nothing was removed.`
          }
          const names = [
            ...frames.map((id) => `frame "${c.iframeLayers.get(id)!.label}"`),
            ...documents.map(
              (id) =>
                `document "${c.markdownLayers.get(id)!.title || "Untitled"}"`
            ),
          ]
          if (frames.length) freshOps(doc).ops.removeLayers(frames)
          if (documents.length) freshOps(doc).ops.removeDocuments(documents)
          return `Removed ${names.join(", ")}.`
        }),
    }),

    list_changes: tool({
      description:
        "List the canvas changes your recent turns made, newest first, with each turn's id and whether it was undone.",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
      }),
      execute: async () =>
        mutateDoc(({ doc }) => {
          const turns = listTurns(doc)
          if (turns.length === 0) return "No logged canvas changes."
          return turns
            .map((t) =>
              [
                `Turn [${t.turnId}]${t.turnId === turnId ? " (this turn)" : ""}${t.undoneBy ? " (undone)" : ""}:`,
                ...t.actions.map((a) => `- ${a}`),
              ].join("\n")
            )
            .join("\n\n")
        }),
    }),

    undo_changes: tool({
      description:
        "Undo every canvas change one of your turns made, putting removed frames, Groups and documents back exactly as they were. Without `turn_id`, undoes your most recent earlier turn that changed the canvas and isn't undone. Use it when the user asks to undo; the undo itself can be undone the same way.",
      inputSchema: jsonSchema<{ turn_id?: string }>({
        type: "object",
        properties: { turn_id: { type: "string" } },
      }),
      execute: async ({ turn_id }) =>
        change((doc) => {
          const d = doc
          const target =
            turn_id ??
            listTurns(d).find((t) => t.turnId !== turnId && !t.undoneBy)?.turnId
          if (!target) return "Nothing to undo."
          const undone = undoTurn(d, target, turnId)
          if (!undone.ok) return `Error: ${undone.error}`
          return withIds(`Undid: ${undone.actions.map(lowerFirst).join(" ")}`, [
            target,
          ])
        }),
    }),
  }
}

const ORIGIN = { x: 0, y: 0 }

function freshOps(doc: Y.Doc): { ops: CanvasOps; c: RoomCollections } {
  const c = createRoomCollections(doc)
  return { ops: createCanvasOps(c), c }
}

/** A new frame's size for a Workspace: its repository's frame size preset. */
function workspaceFrameSize(
  c: RoomCollections,
  branchId: string
): { width: number; height: number } {
  const branch = c.branches.get(branchId)
  const repo = branch ? c.repos.get(branch.repoId) : undefined
  const { width, height } = getIframeLayerSizePreset(
    repo?.defaultIframeLayerSizeId
  )
  return { width, height }
}

/** The size of a Group's last frame, as the canvas's "add frame" mirrors it. */
function lastFrameSize(
  c: RoomCollections,
  groupId: string
): { width: number; height: number } {
  const group = c.iframeLayerGroups.get(groupId)
  const frames = group
    ? getGroupMembers(group)
        .filter((m) => m.kind === "iframe-layer")
        .map((m) => c.iframeLayers.get(m.id))
        .filter((f) => f !== undefined)
    : []
  const last = frames.at(-1)
  return last
    ? { width: last.width, height: last.height }
    : { width: DEFAULT_IFRAME_LAYER_WIDTH, height: DEFAULT_IFRAME_LAYER_HEIGHT }
}

/** Top-left corner for a new Group of `size`, beside the existing Groups. */
function newGroupAnchor(
  c: RoomCollections,
  size: { width: number; height: number }
): { x: number; y: number } {
  return placeNewIframeLayerGroup(
    c.iframeLayerGroups.toArray(),
    c.iframeLayers.toArray(),
    ORIGIN,
    size.width,
    size.height,
    c.markdownLayers.toArray()
  )
}

/** The Group holding a frame or document, if any. */
function memberGroup(c: RoomCollections, id: string): string | undefined {
  return c.iframeLayerGroups
    .toArray()
    .find((g) => getGroupMembers(g).some((m) => m.id === id))?.id
}

/**
 * A tool result: one line naming what changed, the way the chat's tool row
 * shows it, then the ids the model needs for a follow-up call.
 */
function withIds(line: string, ids: string[]): string {
  return `${line}\nIds: ${ids.join(", ")}`
}

/** The line a result shows in the chat, without its ids. */
export function resultLine(result: string): string {
  return result.split("\n")[0]!
}

function forWorkspace(branch: BranchData | undefined): string {
  return branch ? ` for ${workspaceLabel(branch)}` : ""
}

function frameNames(frames: { label: string }[]): string {
  const names = frames.map((f) => `"${f.label}"`).join(", ")
  return `${frames.length === 1 ? "frame" : "frames"} ${names}`
}

/** Frames and documents by name: `frame "Settings", document "Launch spec"`. */
function memberNames(c: RoomCollections, ids: string[]): string {
  return ids
    .map((id) => {
      const frame = c.iframeLayers.get(id)
      if (frame) return `frame "${frame.label}"`
      return `document "${c.markdownLayers.get(id)?.title || "Untitled"}"`
    })
    .join(", ")
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}
