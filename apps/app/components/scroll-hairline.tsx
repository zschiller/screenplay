"use client"

import { useCallback, useEffect, useState } from "react"
import { cn } from "@workspace/ui/lib/utils"

/**
 * A hairline at the edge of a dialog's scroll, shown only while content is
 * scrolled under it: under the header once the content scrolls up (`top`),
 * above a footer while more lies below (`bottom`). Goes inside a `relative`
 * wrapper around the scroll; it overlays the content, so showing it moves
 * nothing. Every scrolling dialog uses it (pickers, repository dialogs,
 * Canvas settings, the skill viewer, Move to).
 */
export function ScrollHairline({
  shown,
  edge = "top",
}: {
  shown: boolean
  edge?: "top" | "bottom"
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 z-10 h-px bg-border transition-opacity duration-150",
        edge === "top" ? "top-0" : "bottom-0",
        shown ? "opacity-100" : "opacity-0"
      )}
    />
  )
}

/**
 * Whether a scroll has content above (scrolled down) and below (more to
 * scroll), for its {@link ScrollHairline}s. Pass `attach` as the `ref` of the
 * scrolling element
 * or on a shadcn `ScrollArea` (its viewport is measured), and `onScroll` on
 * the same element: a `ScrollArea` takes it as `onScrollCapture`, since the
 * viewport's scroll doesn't bubble. Content that changes height without a
 * scroll (a section opening, a file loading) re-measures too.
 */
export function useScrollEdges<T extends HTMLElement = HTMLDivElement>() {
  // A callback ref, so a scroll that mounts later (inside a dialog that
  // opens after its owner rendered) is still watched.
  const [element, attach] = useState<T | null>(null)
  const [edges, setEdges] = useState({ above: false, below: false })

  const onScroll = useCallback(() => {
    const viewport = scrollViewport(element)
    if (!viewport) return
    const { scrollTop, scrollHeight, clientHeight } = viewport
    const above = scrollTop > 0
    const below = scrollHeight - scrollTop - clientHeight > 1
    setEdges((prev) =>
      prev.above === above && prev.below === below ? prev : { above, below }
    )
  }, [element])

  useEffect(() => {
    const viewport = scrollViewport(element)
    if (!viewport || typeof ResizeObserver === "undefined") return
    const resize = new ResizeObserver(onScroll)
    const observe = () => {
      resize.disconnect()
      resize.observe(viewport)
      for (const child of viewport.children) resize.observe(child)
    }
    observe()
    // Swapped content (another settings section, a loaded file) brings new
    // children to watch.
    const mutation = new MutationObserver(() => {
      observe()
      onScroll()
    })
    mutation.observe(viewport, { childList: true })
    return () => {
      resize.disconnect()
      mutation.disconnect()
    }
  }, [element, onScroll])

  return { attach, onScroll, ...edges }
}

function scrollViewport(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null
  if (element.dataset.slot === "scroll-area")
    return element.querySelector<HTMLElement>(
      "[data-slot=scroll-area-viewport]"
    )
  return element
}
