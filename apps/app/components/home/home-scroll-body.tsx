"use client"

import { useEffect, useRef, useState } from "react"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"

// The breathing room above the heading at rest. It's a real scrollable spacer,
// so it scrolls away natively as the sticky header rises to pin at the top —
// no JS-driven height animation, just position: sticky. Keep the px in sync
// with the spacer's `h-*` class below; it's the threshold for "header pinned".
const TOP_SPACE_PX = 16

/**
 * The scrollable home body with a sticky header. The header sits inside the
 * scroll viewport above the content; spacers give it initial breathing room
 * that scrolls away as the header pins to the top — driven entirely by
 * position: sticky.
 *
 * The hairline is a floating overlay (a sibling of the scroll viewport, like
 * the create-branch dialog's), parked at the header's bottom edge so the
 * content scrolls *underneath* it. It can't be a child of the header — then it
 * would ride the header's opaque band and never sit over the content.
 *
 * Radix wraps the viewport's children in a `display: table` element, which
 * defeats position: sticky, so we override that wrapper back to `block`.
 */
export function HomeScrollBody({
  header,
  children,
}: {
  header: React.ReactNode
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(false)
  const [headerHeight, setHeaderHeight] = useState(0)

  useEffect(() => {
    const viewport = ref.current?.querySelector<HTMLDivElement>(
      "[data-slot=scroll-area-viewport]"
    )
    if (!viewport) return
    const onScroll = () => setPinned(viewport.scrollTop >= TOP_SPACE_PX)
    onScroll()
    viewport.addEventListener("scroll", onScroll, { passive: true })
    return () => viewport.removeEventListener("scroll", onScroll)
  }, [])

  // The overlay sits at the header's bottom edge; measure it rather than
  // hardcoding so it tracks whatever height each page's header renders at.
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const measure = () => setHeaderHeight(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={ref} className="relative min-h-0 flex-1">
      <ScrollArea
        orientation="vertical"
        // Override the viewport's display:table wrapper back to block so the
        // header's position: sticky works, and lift the scrollbar above the
        // sticky header (z-10) so the header never paints over it.
        className="h-full [&>[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-scrollbar]]:z-20"
      >
        {/* Breathing room above the heading; scrolls away as the header pins. */}
        <div data-tauri-drag-region className="h-4" />
        <div ref={headerRef} className="sticky top-0 z-10 bg-background">
          {header}
        </div>
        {/* Breathing room below the heading; scrolls under the pinned header. */}
        <div className="h-4" />
        {children}
      </ScrollArea>

      {/* Hairline copied from the create-branch dialog: a floating overlay over
          the scroll content, parked at the header's bottom edge and revealed
          once the header pins. Content scrolls beneath it. */}
      <div
        aria-hidden
        style={{ top: headerHeight }}
        className={cn(
          "pointer-events-none absolute inset-x-0 z-30 h-px shadow-[inset_0_1px_0_0_rgb(0_0_0/0.08)] transition-opacity duration-150 dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.1)]",
          pinned ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  )
}
