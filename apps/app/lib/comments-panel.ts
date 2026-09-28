/**
 * The comments panel's list (#787): which threads a filter shows, and how
 * they group by the frame (or document) and route they're on. React-free so
 * the panel's order, the one J/K walks, is testable on its own.
 */

import type { Placement } from "@/lib/comment-anchor"
import type { ThreadWithComments } from "@/lib/comments"

export type CommentFilter = "open" | "mine" | "unread" | "resolved"

export interface CommentGroup {
  key: string
  /** The frame or document's title; null for detached threads. */
  title: string | null
  /** The route the group's frame threads were made on. */
  route: string | null
  detached: boolean
  threads: ThreadWithComments[]
}

export function lastActivity(thread: ThreadWithComments): number {
  return thread.comments.at(-1)?.createdAt ?? thread.createdAt
}

/** Whether `userId` started or replied to the thread. */
export function isMine(thread: ThreadWithComments, userId: string | null) {
  if (!userId) return false
  return (
    thread.createdBy === userId ||
    thread.comments.some((c) => c.authorId === userId)
  )
}

function layerTitle(
  layer: { title?: string } | undefined,
  isDocument: boolean
): string {
  if (!layer) return isDocument ? "Deleted document" : "Deleted frame"
  return layer.title?.trim() || (isDocument ? "Untitled" : "Frame")
}

export function filterThreads(
  threads: readonly ThreadWithComments[],
  filter: CommentFilter,
  userId: string | null
): ThreadWithComments[] {
  switch (filter) {
    case "open":
      return threads.filter((t) => !t.resolved)
    case "mine":
      return threads.filter((t) => !t.resolved && isMine(t, userId))
    case "unread":
      return threads.filter((t) => !t.resolved && t.unread)
    case "resolved":
      return threads.filter((t) => t.resolved)
  }
}

/**
 * Group threads by frame and route (or by document), most recently active
 * group first, most recently active thread first within it. Resolved threads
 * order by when they were resolved. Detached threads, whose frame or element
 * is gone, have nothing to group by and come last in one group of their own.
 */
export function groupThreads(
  threads: readonly ThreadWithComments[],
  placements: ReadonlyMap<string, Placement>,
  describeLayer: (id: string) => { title?: string; route?: string } | undefined
): CommentGroup[] {
  const recency = (t: ThreadWithComments) =>
    t.resolved ? (t.resolvedAt ?? lastActivity(t)) : lastActivity(t)
  const sorted = [...threads].sort((a, b) => recency(b) - recency(a))
  const groups = new Map<string, CommentGroup>()
  const detached: ThreadWithComments[] = []
  for (const thread of sorted) {
    const placement = placements.get(thread.id)
    if (placement?.kind === "detached") {
      detached.push(thread)
      continue
    }
    const layerId = thread.documentId ?? thread.iframeLayerId
    const route = thread.documentId
      ? null
      : placement?.kind === "offRoute"
        ? placement.route
        : thread.route
    const key = `${layerId ?? ""}\u0000${route ?? ""}`
    let group = groups.get(key)
    if (!group) {
      const title = layerId
        ? layerTitle(describeLayer(layerId), !!thread.documentId)
        : "Canvas"
      group = { key, title, route, detached: false, threads: [] }
      groups.set(key, group)
    }
    group.threads.push(thread)
  }
  const result = [...groups.values()]
  if (detached.length > 0) {
    result.push({
      key: "detached",
      title: null,
      route: null,
      detached: true,
      threads: detached,
    })
  }
  return result
}
