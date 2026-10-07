import type { IframeLayerGroupData, PageData } from "@/lib/types"
import { getGroupMembers } from "./layout"
import { groupPageId } from "./pages"

/**
 * The page each Layer and Group is on, by id (#1841): a Group's own, and each
 * Member's through its Group. A layer named in chat on another page switches
 * the canvas there before it's shown. React-free.
 */
export function pageIdsById(
  groups: readonly Pick<
    IframeLayerGroupData,
    "id" | "members" | "iframeLayerIds" | "pageId"
  >[],
  pages: readonly PageData[]
): Map<string, string> {
  const out = new Map<string, string>()
  for (const group of groups) {
    const pageId = groupPageId(group, pages)
    out.set(group.id, pageId)
    for (const m of getGroupMembers(group)) out.set(m.id, pageId)
  }
  return out
}
