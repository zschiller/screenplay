import { getGroupMembers } from "@/lib/canvas/layout"
import { groupPageId, orderedPages, resolvePageId } from "@/lib/canvas/pages"
import type { GroupMember } from "@/lib/types"
import type { RoomCollections } from "@/lib/yjs/schema"

/**
 * Pages as a chat agent sees them (#1842, spec #1834). A chat works on the
 * page its sender is on, or a page it names; it never creates, renames or
 * rearranges pages (that's the Coordinator's). Its new Mockups and Documents
 * land on that page, beside its own Groups there, and its reads say which
 * page each Layer is on.
 */

/** The `page` argument `create_mockup` and `create_document` take. */
export const PAGE_PARAM_DESCRIPTION =
  "An existing page of the canvas to put it on, by name or id. Leave it out to put it on the page the person you’re answering is on (the page their Canvas view footer names), which is almost always right; name one only when they ask for that page. You can’t create pages."

/** The page the sender's message names, read when a tool needs it. */
export type SenderPage = () => Promise<string | undefined>

/**
 * The page a chat's new Layer goes on: the one `named` names (by id, or by
 * name ignoring case), else the sender's, else the first. A name no page has
 * is an error listing the pages, for the model to pick again.
 */
export function pickLayerPage(
  c: Pick<RoomCollections, "pages">,
  named: string | undefined,
  senderPageId: string | undefined
): { pageId: string } | { error: string } {
  const pages = orderedPages(c.pages.toArray())
  const ref = named?.trim()
  if (!ref) return { pageId: resolvePageId(pages, senderPageId) }
  const page =
    pages.find((p) => p.id === ref) ??
    pages.find((p) => p.name.trim().toLowerCase() === ref.toLowerCase())
  if (page) return { pageId: page.id }
  const list = pages.map((p) => `"${p.name}" (${p.id})`).join(", ")
  return {
    error: `Error: there’s no page "${ref}" on this canvas. Its pages are ${list}. Name one of them, or leave page out for the sender’s page.`,
  }
}

/**
 * The name of the page a Layer is on, for a read to report; `undefined` on a
 * one-page canvas (where it says nothing) or for a Layer in no Group.
 */
export function layerPageName(
  c: Pick<RoomCollections, "pages" | "iframeLayerGroups">,
  member: GroupMember
): string | undefined {
  const pages = orderedPages(c.pages.toArray())
  if (pages.length < 2) return undefined
  const group = c.iframeLayerGroups
    .toArray()
    .find((g) =>
      getGroupMembers(g).some(
        (m) => m.kind === member.kind && m.id === member.id
      )
    )
  if (!group) return undefined
  const pageId = groupPageId(group, pages)
  return pages.find((p) => p.id === pageId)?.name
}
