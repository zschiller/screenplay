import { tool, jsonSchema, type ToolSet } from "ai"
import type * as Y from "yjs"
import { createCanvasOps, type CanvasOps } from "@/lib/canvas/ops"
import {
  getGroupMembers,
  groupContentHeight,
  groupContentWidth,
  placeNewIframeLayerGroup,
} from "@/lib/canvas/layout"
import { groupPageId, orderedPages } from "@/lib/canvas/pages"
import { sizedLayersOf } from "@/lib/canvas/sized-layers"
import {
  DEFAULT_IFRAME_LAYER_HEIGHT,
  DEFAULT_IFRAME_LAYER_WIDTH,
} from "@/lib/constants"
import { getIframeLayerSizePreset } from "@/lib/iframe-layer-sizes"
import { routeToLabel } from "@/lib/route-utils"
import { createRoomCollections, type RoomCollections } from "@/lib/yjs/schema"
import { listTurns, recordChange, undoTurn } from "@/lib/agent/room-change-log"
import type { RoomDoc } from "@/lib/room-access"
import type { BranchData, PageData } from "@/lib/types"
import { workspaceLabel } from "@/lib/workspace-label"
import { annotateTools } from "@/lib/mcp/tool-server"

/**
 * The Coordinator's arrange tools (#894): create frames; move, group, merge
 * and remove frames and documents; rename frames and Groups; create, rename
 * and delete pages and move things between them (#1843); plus the change
 * log's `list_changes` and
 * `undo_changes`. They act right away, with no confirmation. Every write goes
 * through Canvas Operations inside one server-side room mutation, logged
 * under `turnId` so the Coordinator can undo a turn when asked. None creates
 * or edits a Document or Mockup: the Coordinator starts a chat for those, and
 * that chat owns what it makes (#1316).
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

  const tools = {
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
            const ids = frames.map((f) =>
              freshOps(doc).ops.addFrameToGroup(group_id, {
                ...size,
                label: f.label,
                ...(workspace_id ? { branchId: workspace_id } : {}),
                ...(f.route ? { route: f.route } : {}),
              })!
            )
            return withIds(
              `Added ${frameNames(frames)}${forWorkspace(branch)} to group “${group.name ?? group_id}”.`,
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
            `Created ${frameNames(frames)}${forWorkspace(branch)} in a new group.`,
            [...ids, created.groupId]
          )
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
          return `Moved group “${group.name ?? group_id}” to ${Math.round(x)}, ${Math.round(y)}.${overlapNote(freshOps(doc).c, group_id)}`
        }),
    }),

    arrange_groups: tool({
      description:
        "Lay Groups out in the given order so none overlap: `row` (left to right, tops aligned), `column` (top to bottom, left edges aligned) or `grid` (rows of `columns`, default about square). They start at the top-left corner of where the listed Groups are now, or below the rest of the canvas when that would land on Groups left out. Use it to tidy the canvas or put Groups side by side instead of working out positions for `move_group`.",
      inputSchema: jsonSchema<{
        group_ids: string[]
        layout: "row" | "column" | "grid"
        columns?: number
      }>({
        type: "object",
        properties: {
          group_ids: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
          layout: { type: "string", enum: ["row", "column", "grid"] },
          columns: { type: "integer", minimum: 1 },
        },
        required: ["group_ids", "layout"],
      }),
      execute: async ({ group_ids, layout, columns }) =>
        change((doc) => {
          const { ops, c } = freshOps(doc)
          const missing = group_ids.filter((id) => !c.iframeLayerGroups.get(id))
          if (missing.length) return `Error: no Group ${missing.join(", ")}.`
          const ids = [...new Set(group_ids)]
          const rects = groupRects(c)
          const listed = ids.map((id) => ({ id, ...rects.get(id)! }))
          const others = [...rects].filter(([id]) => !ids.includes(id))
          // From the corner of where the listed Groups are now.
          const corner = {
            x: Math.min(...listed.map((r) => r.x)),
            y: Math.min(...listed.map((r) => r.y)),
          }
          let placed = arrangeRects(listed, layout, corner, columns)
          // Where that lands on Groups left out, start below all of them.
          const below = clearsOthers(placed, rects, others)
            ? null
            : {
                x: corner.x,
                y:
                  Math.max(...others.map(([, r]) => r.y + r.height)) +
                  ARRANGE_GAP,
              }
          if (below) placed = arrangeRects(listed, layout, below, columns)
          for (const [id, { x, y }] of placed) {
            ops.patch("iframeLayerGroups", id, { x, y })
          }
          const names = ids.map((id) => `“${groupName(c, id)}”`).join(", ")
          const where = {
            row: "in a row",
            column: "in a column",
            grid: "in a grid",
          }[layout]
          return `Laid out groups ${names} ${where}${below ? ", below the rest of the canvas" : ""}.`
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
            return withIds(`Gathered ${names} into a new group.`, [newId])
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
          return `Moved ${names} into group “${target.name ?? group_id}”.${overlapNote(freshOps(doc).c, group_id)}`
        }),
    }),

    merge_groups: tool({
      description:
        "Merge one Group into another: the source’s frames and documents are appended to the target’s row and the source Group is removed.",
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
          return `Merged group “${source.name ?? source_group_id}” into “${target.name ?? target_group_id}”.${overlapNote(freshOps(doc).c, target_group_id)}`
        }),
    }),

    rename: tool({
      description: "Rename a frame or a Group.",
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
            return `Renamed frame “${frame.label}” to “${name}”.`
          }
          const group = c.iframeLayerGroups.get(id)
          if (group) {
            ops.patch("iframeLayerGroups", id, { name })
            return `Renamed group “${group.name ?? id}” to “${name}”.`
          }
          return `Error: no frame or Group ${id}.`
        }),
    }),

    remove: tool({
      description:
        "Remove frames and documents. A Group left empty is removed with them. Removing a frame never touches its Workspace, and removing a document takes only that view off the canvas: its file stays. Undo with `undo_changes`.",
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
            ...frames.map((id) => `frame “${c.iframeLayers.get(id)!.label}”`),
            ...documents.map(
              (id) =>
                `document “${c.markdownLayers.get(id)!.title || "Untitled"}”`
            ),
          ]
          if (frames.length) freshOps(doc).ops.removeLayers(frames)
          if (documents.length) freshOps(doc).ops.removeDocuments(documents)
          return `Removed ${names.join(", ")}.`
        }),
    }),

    create_page: tool({
      description:
        "Add a page to the canvas, named `name` (or the next “Page N”), at the end of the pages list or right after the page `after` names (by name or id). It starts empty; move Groups or layers onto it with `move_to_page`.",
      inputSchema: jsonSchema<{ name?: string; after?: string }>({
        type: "object",
        properties: {
          name: { type: "string" },
          after: {
            type: "string",
            description: "The page to put it after, by name or id.",
          },
        },
      }),
      execute: async ({ name, after }) =>
        change((doc) => {
          const { ops, c } = freshOps(doc)
          const anchor = after === undefined ? undefined : findPage(c, after)
          if (anchor && "error" in anchor) return anchor.error
          const id = ops.createPage({ name })
          if (anchor) {
            const order = freshOps(doc)
              .ops.listPages()
              .map((p) => p.id)
            const rest = order.filter((p) => p !== id)
            rest.splice(rest.indexOf(anchor.page.id) + 1, 0, id)
            freshOps(doc).ops.reorderPages(rest)
          }
          const page = freshOps(doc).c.pages.get(id)!
          const where = anchor ? ` after “${anchor.page.name}”` : ""
          return withIds(`Created page “${page.name}”${where}.`, [id])
        }),
    }),

    rename_page: tool({
      description: "Rename a page, named by its name or id.",
      inputSchema: jsonSchema<{ page: string; name: string }>({
        type: "object",
        properties: {
          page: { type: "string" },
          name: { type: "string", minLength: 1 },
        },
        required: ["page", "name"],
      }),
      execute: async ({ page, name }) =>
        change((doc) => {
          const { ops, c } = freshOps(doc)
          const found = findPage(c, page)
          if ("error" in found) return found.error
          if (!name.trim()) return "Error: a page needs a name."
          ops.renamePage(found.page.id, name)
          return `Renamed page “${found.page.name}” to “${name.trim()}”.`
        }),
    }),

    delete_page: tool({
      description:
        "Delete a page, named by its name or id, with every Group, frame, document and mockup on it. Chats whose frames were on it keep running. It refuses the canvas’s last page. Undo with `undo_changes`.",
      inputSchema: jsonSchema<{ page: string }>({
        type: "object",
        properties: { page: { type: "string" } },
        required: ["page"],
      }),
      execute: async ({ page }) =>
        change((doc) => {
          const { ops, c } = freshOps(doc)
          const found = findPage(c, page)
          if ("error" in found) return found.error
          if (ops.listPages().length < 2) {
            return `Error: “${found.page.name}” is the canvas’s only page, and a canvas always keeps one. Nothing was deleted.`
          }
          const items = ops
            .groupsOnPage(found.page.id)
            .reduce((n, g) => n + getGroupMembers(g).length, 0)
          ops.deletePage(found.page.id)
          const what = items ? ` and the ${plural(items, "layer")} on it` : ""
          return `Deleted page “${found.page.name}”${what}.`
        }),
    }),

    move_to_page: tool({
      description:
        "Move Groups, frames, documents and mockups to another page, named by its name or id. A Group moves whole; layers named on their own leave their Group for a new one on that page (all of one Group’s layers move the Group). They land right of what’s already there, so nothing overlaps.",
      inputSchema: jsonSchema<{ ids: string[]; page: string }>({
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "string" }, minItems: 1 },
          page: { type: "string" },
        },
        required: ["ids", "page"],
      }),
      execute: async ({ ids, page }) =>
        change((doc) => {
          const { c } = freshOps(doc)
          const found = findPage(c, page)
          if ("error" in found) return found.error
          const groupIds = ids.filter((id) => c.iframeLayerGroups.has(id))
          const layerIds = ids.filter(
            (id) => !groupIds.includes(id) && memberGroup(c, id)
          )
          const unknown = ids.filter(
            (id) => !groupIds.includes(id) && !layerIds.includes(id)
          )
          if (unknown.length) {
            return `Error: no Group, frame, document or mockup ${unknown.join(", ")} on the canvas. Nothing was moved.`
          }
          const pages = orderedPages(c.pages.toArray())
          const pageId = found.page.id
          const onPage = (groupId: string) =>
            groupPageId(c.iframeLayerGroups.get(groupId)!, pages) === pageId
          const movingGroups = groupIds.filter((id) => !onPage(id))
          const movingLayers = layerIds.filter(
            (id) => !onPage(memberGroup(c, id)!)
          )
          if (movingGroups.length + movingLayers.length === 0) {
            return `Already on page “${found.page.name}”; nothing moved.`
          }
          const names = [
            ...movingGroups.map((id) => `group “${groupName(c, id)}”`),
            ...(movingLayers.length ? [memberNames(c, movingLayers)] : []),
          ].join(", ")
          const landed: string[] = []
          for (const id of movingGroups) {
            freshOps(doc).ops.moveGroupToPage(id, pageId)
            landed.push(id)
          }
          if (movingLayers.length) {
            const moved = freshOps(doc).ops.moveLayersToPage(
              movingLayers,
              pageId
            )
            if (moved) landed.push(moved)
          }
          return withIds(`Moved ${names} to page “${found.page.name}”.`, landed)
        }),
    }),

    list_changes: tool({
      description:
        "List the canvas changes your recent turns made, newest first, with each turn’s id and whether it was undone.",
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
        "Undo every canvas change one of your turns made, putting removed frames, Groups and documents back exactly as they were. Without `turn_id`, undoes your most recent earlier turn that changed the canvas and isn’t undone. Use it when the user asks to undo; the undo itself can be undone the same way.",
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
  // Canvas-only writes, every one undoable with `undo_changes`, so none is
  // destructive for a harness reaching them over MCP.
  return annotateTools(tools, {
    create_frames: { destructiveHint: false, openWorldHint: false },
    move_group: { destructiveHint: false, openWorldHint: false },
    arrange_groups: { destructiveHint: false, openWorldHint: false },
    move_to_group: { destructiveHint: false, openWorldHint: false },
    merge_groups: { destructiveHint: false, openWorldHint: false },
    rename: { destructiveHint: false, openWorldHint: false },
    remove: { destructiveHint: false, openWorldHint: false },
    create_page: { destructiveHint: false, openWorldHint: false },
    rename_page: { destructiveHint: false, openWorldHint: false },
    delete_page: { destructiveHint: false, openWorldHint: false },
    move_to_page: { destructiveHint: false, openWorldHint: false },
    undo_changes: { destructiveHint: false, openWorldHint: false },
    list_changes: { readOnlyHint: true, openWorldHint: false },
  })
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
    sizedLayersOf(c)
  )
}

/** Space between Groups laid out by `arrange_groups`, clear of their names. */
const ARRANGE_GAP = 200

type GroupRect = { x: number; y: number; width: number; height: number }

/** Every Group's canvas rect: its top-left corner and its row's extent. */
function groupRects(c: RoomCollections): Map<string, GroupRect> {
  const frames = c.iframeLayers.toArray()
  const sized = sizedLayersOf(c)
  return new Map(
    c.iframeLayerGroups.toArray().map((g) => [
      g.id,
      {
        x: g.x,
        y: g.y,
        width: groupContentWidth(g, frames, sized),
        height: groupContentHeight(g, frames, sized),
      },
    ])
  )
}

/**
 * New top-left corners for `rects`, by id, laid out in order from `origin`
 * with {@link ARRANGE_GAP} between them. A grid's columns line up: each is as
 * wide as its widest Group, each row as tall as its tallest.
 */
function arrangeRects(
  rects: readonly (GroupRect & { id: string })[],
  layout: "row" | "column" | "grid",
  origin: { x: number; y: number },
  columns?: number
): Map<string, { x: number; y: number }> {
  const perRow =
    layout === "row"
      ? rects.length
      : layout === "column"
        ? 1
        : (columns ?? Math.ceil(Math.sqrt(rects.length)))
  const colWidth = (col: number) =>
    Math.max(...rects.filter((_, i) => i % perRow === col).map((r) => r.width))
  const placed = new Map<string, { x: number; y: number }>()
  let y = Math.round(origin.y)
  for (let start = 0; start < rects.length; start += perRow) {
    const row = rects.slice(start, start + perRow)
    let x = Math.round(origin.x)
    row.forEach((r, col) => {
      placed.set(r.id, { x, y })
      // A row lays its Groups end to end; a grid keeps its columns aligned.
      const width = layout === "grid" ? colWidth(col) : r.width
      x += Math.round(width) + ARRANGE_GAP
    })
    y += Math.round(Math.max(...row.map((r) => r.height))) + ARRANGE_GAP
  }
  return placed
}

function intersects(a: GroupRect, b: GroupRect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}

/** Whether the `placed` Groups clear every one of `others`. */
function clearsOthers(
  placed: Map<string, { x: number; y: number }>,
  rects: Map<string, GroupRect>,
  others: [string, GroupRect][]
): boolean {
  return [...placed].every(([id, at]) =>
    others.every(([, r]) => !intersects({ ...rects.get(id)!, ...at }, r))
  )
}

/**
 * ` It now overlaps "Cart".` when Group `id` sits on other Groups after a
 * change, so the model can clear them; empty otherwise.
 */
function overlapNote(c: RoomCollections, id: string): string {
  const rects = groupRects(c)
  const rect = rects.get(id)
  if (!rect) return ""
  const hit = [...rects]
    .filter(([other, r]) => other !== id && intersects(rect, r))
    .map(([other]) => `“${groupName(c, other)}”`)
  return hit.length ? ` It now overlaps ${hit.join(", ")}.` : ""
}

function groupName(c: RoomCollections, id: string): string {
  return c.iframeLayerGroups.get(id)?.name ?? id
}

/** The Group holding a frame, document or mockup, if any. */
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
  const names = frames.map((f) => `“${f.label}”`).join(", ")
  return `${frames.length === 1 ? "frame" : "frames"} ${names}`
}

/** Group members by name: `frame "Settings", document "Launch spec"`. */
function memberNames(c: RoomCollections, ids: string[]): string {
  return ids
    .map((id) => {
      const frame = c.iframeLayers.get(id)
      if (frame) return `frame “${frame.label}”`
      const mockup = c.mockupLayers.get(id)
      if (mockup) return `mockup “${mockup.title || "Untitled"}”`
      return `document “${c.markdownLayers.get(id)?.title || "Untitled"}”`
    })
    .join(", ")
}

/**
 * The page `ref` names, by id or by name ignoring case; a name no page has is
 * an error listing the pages, for the model to pick again.
 */
function findPage(
  c: RoomCollections,
  ref: string
): { page: PageData } | { error: string } {
  const pages = orderedPages(c.pages.toArray())
  const wanted = ref.trim()
  const page =
    pages.find((p) => p.id === wanted) ??
    pages.find((p) => p.name.trim().toLowerCase() === wanted.toLowerCase())
  if (page) return { page }
  const list = pages.map((p) => `“${p.name}” (${p.id})`).join(", ")
  return {
    error: `Error: there’s no page “${wanted}” on this canvas. Its pages are ${list}.`,
  }
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}
