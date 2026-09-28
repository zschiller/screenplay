"use client"

import { useEffect, useState, type RefObject } from "react"

// A tab counts as overflowing once less than this share of it is inside the
// strip. Just under 1 so sub-pixel widths don't flip a tab that fits.
const VISIBLE_RATIO = 0.99

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

/**
 * The ids of the tabs that don't fully fit in `containerRef`, a strip that clips
 * its overflow. Each tab is an element carrying `data-tab-id` inside the strip.
 * The strip hides these tabs rather than clipping them part-way, and lists them
 * in its overflow menu.
 *
 * An IntersectionObserver rooted on the strip does the measuring, so a resize,
 * a rename, or a tab growing in on its enter animation all re-measure without
 * any layout reads of our own. `ids` is the displayed order and `epoch` any
 * value that changes when the tab elements remount, since either swaps the
 * elements the observer is watching.
 */
export function useOverflowingTabs(
  containerRef: RefObject<HTMLElement | null>,
  ids: string[],
  epoch: number = 0
): Set<string> {
  const [overflowing, setOverflowing] = useState<Set<string>>(() => new Set())
  const key = `${epoch}\u0000${ids.join("\u0000")}`

  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const clipped = new Map<string, boolean>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.tabId
          if (id) clipped.set(id, entry.intersectionRatio < VISIBLE_RATIO)
        }
        const next = new Set<string>()
        for (const [id, isClipped] of clipped) if (isClipped) next.add(id)
        setOverflowing((prev) => (sameSet(prev, next) ? prev : next))
      },
      { root, threshold: [0, VISIBLE_RATIO, 1] }
    )
    root
      .querySelectorAll<HTMLElement>("[data-tab-id]")
      .forEach((el) => io.observe(el))
    return () => io.disconnect()
    // `key` stands in for `ids` and `epoch`: re-observe when the elements change.
  }, [containerRef, key])

  return overflowing
}
