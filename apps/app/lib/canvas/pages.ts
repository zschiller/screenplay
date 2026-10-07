import type { PageData } from "@/lib/types"

/**
 * Pages of a canvas (#1835, spec #1834): the ordered, named partitions of its
 * Groups. Pure reads over the room's `pages` records; the writes are Canvas
 * Operations (`createPage` in `lib/canvas/ops.ts`).
 *
 * A canvas from before pages has no records. It reads as one "Page 1" with
 * this fixed id, so every client agrees on it before anyone writes it, and a
 * Group with no `pageId` is on the first page: existing canvases open with no
 * migration write.
 */
export const FIRST_PAGE_ID = "page-1"

/** The page a canvas without page records shows its content on. */
export const FIRST_PAGE: PageData = {
  id: FIRST_PAGE_ID,
  name: "Page 1",
  order: 0,
}

/** The canvas's pages in list order; never empty. */
export function orderedPages(records: readonly PageData[]): PageData[] {
  if (records.length === 0) return [FIRST_PAGE]
  return [...records].sort((a, b) =>
    a.order !== b.order ? a.order - b.order : a.id.localeCompare(b.id)
  )
}

/** `pageId` when it names one of `pages`, else the first page's id. */
export function resolvePageId(
  pages: readonly PageData[],
  pageId: string | undefined
): string {
  if (pageId && pages.some((p) => p.id === pageId)) return pageId
  return pages[0]?.id ?? FIRST_PAGE_ID
}

/** The page a Group is on: its own when that page exists, else the first. */
export function groupPageId(
  group: { pageId?: string },
  pages: readonly PageData[]
): string {
  return resolvePageId(pages, group.pageId)
}

/** The Groups on page `pageId`, in their given order. */
export function groupsOnPage<G extends { pageId?: string }>(
  groups: readonly G[],
  pages: readonly PageData[],
  pageId: string
): G[] {
  const target = resolvePageId(pages, pageId)
  return groups.filter((g) => groupPageId(g, pages) === target)
}

/**
 * The name + gives a new page: "Page N", one past the highest "Page N" so far
 * (or past the page count, when that's higher), so a name is never reused
 * while its page is still there.
 */
export function nextPageName(pages: readonly PageData[]): string {
  let max = pages.length
  for (const p of pages) {
    const m = /^Page (\d+)$/.exec(p.name)
    if (m) max = Math.max(max, parseInt(m[1]!, 10))
  }
  return `Page ${max + 1}`
}

/**
 * Where someone looking at page `goneId` goes once it's deleted (#1836): the
 * nearest page above it in `before` (the list as it was) that's still in
 * `after`, else the nearest below, else the first page.
 */
export function pageAfterDelete(
  before: readonly PageData[],
  after: readonly PageData[],
  goneId: string
): string {
  const remaining = new Set(after.map((p) => p.id))
  const index = before.findIndex((p) => p.id === goneId)
  if (index >= 0) {
    for (let i = index - 1; i >= 0; i--)
      if (remaining.has(before[i]!.id)) return before[i]!.id
    for (let i = index + 1; i < before.length; i++)
      if (remaining.has(before[i]!.id)) return before[i]!.id
  }
  return after[0]?.id ?? FIRST_PAGE_ID
}

/** The query param a link to a page carries (#1836): `/{roomId}?page=…`. */
export const PAGE_PARAM = "page"
