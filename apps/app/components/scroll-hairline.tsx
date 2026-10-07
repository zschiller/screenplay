"use client"

import { useCallback, useEffect, useState } from "react"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"

/**
 * A hairline at the edge of a dialog's scroll, shown only while content is
 * scrolled under it: under the header once the content scrolls up (`top`),
 * above a footer while more lies below (`bottom`). Goes inside a `relative`
 * wrapper around the scroll; it overlays the content, so showing it moves
 * nothing. Every scrolling dialog uses it (pickers, repository dialogs,
 * Canvas settings, the skill viewer, Move to); a dialog's body scroll gets it
 * through {@link DialogScrollBody}.
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
 * A dialog's body scroll, with the dialog rules built in: no padding above
 * the first item (the header's own bottom padding spaces it; Zack
 * 2026-10-06), a hairline under the header only once the content scrolls up,
 * and, with a `footer` under the body, one above it only while more lies
 * below. Callers give the sides, bottom and gaps.
 */
export function DialogScrollBody({
  children,
  className,
  wrapperClassName,
  footer = false,
  scrollArea,
}: {
  children: React.ReactNode
  /** The scrolling content's sides, bottom padding and layout. Never a top
   *  padding: it's dropped. */
  className?: string
  /** Sizes the body in its dialog (`flex-1` in a flex column). */
  wrapperClassName?: string
  /** A footer sits right under the body. */
  footer?: boolean
  /** Scroll in a shadcn `ScrollArea` with these classes (its viewport's
   *  max-height) instead of a native overflow. */
  scrollArea?: string
}) {
  const { attach, onScroll, above, below } = useScrollEdges()

  return (
    <div className={cn("relative", wrapperClassName)}>
      <ScrollHairline shown={above} />
      {scrollArea === undefined ? (
        <div
          ref={attach}
          onScroll={onScroll}
          className={cn("overflow-y-auto", className, "pt-0")}
        >
          {children}
        </div>
      ) : (
        // Scroll doesn't bubble out of the Radix viewport, so its scroll is
        // caught on the way down.
        <ScrollArea
          ref={attach}
          orientation="vertical"
          onScrollCapture={onScroll}
          className={scrollArea}
        >
          <div className={cn(className, "pt-0")}>{children}</div>
        </ScrollArea>
      )}
      {footer && <ScrollHairline shown={below} edge="bottom" />}
    </div>
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
