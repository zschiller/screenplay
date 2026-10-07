import type { PageData, PageViewData, ViewportData } from "@/lib/types"
import { resolvePageId } from "@/lib/canvas/pages"

/**
 * Each member's own view of each Page (#1838, spec #1834). Pure reads over the
 * room's `pageViews` records; the writes are Canvas Operations
 * (`savePageView`, `removePageViews`, `removeMemberViews` in
 * `lib/canvas/ops.ts`).
 *
 * A member opens the canvas on the page they were last on, at their view of
 * it. A page they've never been on has no view, and the canvas fits its
 * content. The one exception is the shared `savedViewport` of a canvas from
 * before pages: it's everyone's first view of the first page, so an existing
 * canvas opens where it used to, until each member's own view replaces it.
 */

/** The `pageViews` key of `userId`'s view of `pageId`. */
export function pageViewKey(userId: string, pageId: string): string {
  return `${userId}:${pageId}`
}

/**
 * The page the canvas opens on for `userId`: `requestedPageId` when it names a
 * page (a link to one), else the page they were on last, else the first.
 */
export function openPageId(
  views: readonly PageViewData[],
  pages: readonly PageData[],
  userId: string,
  requestedPageId?: string
): string {
  if (requestedPageId && pages.some((p) => p.id === requestedPageId))
    return requestedPageId
  let last: PageViewData | undefined
  for (const v of views) {
    if (v.userId !== userId) continue
    if (!pages.some((p) => p.id === v.pageId)) continue
    if (!last || v.seenAt > last.seenAt) last = v
  }
  return resolvePageId(pages, last?.pageId)
}

/**
 * Where `userId`'s camera goes on `pageId`: their own view, else (first page
 * only) the canvas's old shared `savedViewport`, else null for "fit the
 * page's content".
 */
export function pageViewport(
  views: readonly PageViewData[],
  pages: readonly PageData[],
  userId: string | undefined,
  pageId: string,
  legacy: ViewportData | null
): ViewportData | null {
  const own = userId
    ? views.find((v) => v.userId === userId && v.pageId === pageId)
    : undefined
  if (own) return { x: own.x, y: own.y, zoom: own.zoom }
  if (legacy && pageId === resolvePageId(pages, undefined)) return legacy
  return null
}
