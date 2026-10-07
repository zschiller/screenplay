import { getGroupMembers } from "@/lib/canvas/layout"
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
