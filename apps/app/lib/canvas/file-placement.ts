import { unionRect } from "@/lib/canvas/camera"
import { getGroupMembers, type GroupMemberLayout } from "@/lib/canvas/layout"
import { lastChangedBy } from "@/lib/canvas/layer-chat"
import { groupsOnPage, orderedPages } from "@/lib/canvas/pages"
import type { GroupMember } from "@/lib/types"
import type { RoomCollections } from "@/lib/yjs/schema"

/**
 * The Group a view of a chat's file joins on page `pageId` when it's added to
 * the canvas (#1885): the Group of the latest Mockup, else Document, the chat
 * changed there, else the Group of its Workspace's first frame there, else
 * `undefined` (a new Group beside the others on that page). The rule new
 * Mockups land by (`mockupGroupFor`), counting Documents too.
 */
export function chatGroupFor(
  collections: RoomCollections,
  chatId: string | undefined,
  pageId: string
): string | undefined {
  if (!chatId) return undefined
  const groups = groupsOnPage(
    collections.iframeLayerGroups.toArray(),
    orderedPages(collections.pages.toArray()),
    pageId
  )
  const groupOf = (kind: GroupMember["kind"], id: string) =>
    groups.find((g) =>
      getGroupMembers(g).some((m) => m.kind === kind && m.id === id)
    )?.id
  const latestIn = (
    kind: "mockup-layer" | "markdown-layer",
    views: readonly { id: string; lastChangedByChatId?: string }[]
  ) =>
    views
      .filter((v) => lastChangedBy(v) === chatId)
      .map((v) => groupOf(kind, v.id))
      .filter((id) => id !== undefined)
      .at(-1)
  const latest =
    latestIn("mockup-layer", collections.mockupLayers.toArray()) ??
    latestIn("markdown-layer", collections.markdownLayers.toArray())
  if (latest) return latest
  const branchId = collections.chatSessions.get(chatId)?.branchId
  if (!branchId) return undefined
  return collections.iframeLayers
    .toArray()
    .filter((f) => f.branchId === branchId)
    .map((f) => groupOf("iframe-layer", f.id))
    .find((id) => id !== undefined)
}

/** Where a file dropped on the canvas lands (#1887). */
export type FileDropTarget = { groupId: string; index: number }

/**
 * The Group a Document or Mockup dragged out of the chat joins when it's
 * dropped at world point `point` (#1887): the Group whose members' box holds
 * the point, at the gap nearest it (members whose middle is left of the point
 * stay before it). `null` on empty canvas, where it starts its own Group.
 * `layouts` are the current page's member layouts.
 */
export function fileDropTarget(
  layouts: Iterable<GroupMemberLayout>,
  point: { x: number; y: number }
): FileDropTarget | null {
  const groups = new Map<string, GroupMemberLayout[]>()
  for (const layout of layouts) {
    groups.set(layout.groupId, [...(groups.get(layout.groupId) ?? []), layout])
  }
  for (const [groupId, members] of groups) {
    const box = unionRect(members)
    if (
      !box ||
      point.x < box.x ||
      point.x > box.x + box.width ||
      point.y < box.y ||
      point.y > box.y + box.height
    )
      continue
    const index = members.filter((m) => m.x + m.width / 2 < point.x).length
    return { groupId, index }
  }
  return null
}
