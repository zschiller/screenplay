"use client"

import { useEffect } from "react"
import { targetingStore } from "@/lib/targeting-store"

/**
 * The canvas highlight behind a hovered element token (PRD #616, slice #620),
 * shared by the composer's node view and the sent-message history token.
 *
 * Returns a HoverCard `onOpenChange` handler: opening pushes a
 * `HighlightTarget` into the targeting store (which the Canvas routes to the
 * frame's bridge to draw an outline); closing clears it. Unmounting clears it
 * too, so a sent message, a deleted token, or a torn-down composer can't leave
 * a stuck outline. Every clear is keyed by `ref`, so a token only ever clears
 * the highlight it set — moving the pointer straight from one token to another
 * (enter-before-leave) doesn't wipe the newer token's highlight.
 *
 * A token without a frame layer id or selector (e.g. a legacy history token)
 * still gets its hover card, just no outline.
 */
export function useElementHighlight(
  ref: string,
  iframeLayerId: string | undefined,
  selector: string | undefined
): (open: boolean) => void {
  useEffect(() => {
    return () => targetingStore.clearHighlight(ref)
  }, [ref])

  return (open: boolean) => {
    if (open && iframeLayerId && selector) {
      targetingStore.setHighlight({ iframeLayerId, selector, ref })
    } else {
      targetingStore.clearHighlight(ref)
    }
  }
}
