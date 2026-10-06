"use client"

import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type RefObject,
} from "react"
import { LabelLayerContext } from "./label-layer"

/**
 * What a Layer's label rows fit in: the Layer's width in canvas units, the
 * deferred zoom (for a label off the canvas, with no live camera), and whether
 * the label is compact (far out, menus hidden).
 */
export const LabelFitContext = createContext({
  width: Infinity,
  zoom: 1,
  compact: false,
})

/** The narrowest a label's chat gets (its `min-w-10`), in px. */
const LABEL_CHAT_MIN_WIDTH = 40

/**
 * A label row's chat, after the name. Names win: it gives up its width first,
 * and hides where the name and the chat at its narrowest don't both fit (see
 * `useLabelChatHidden`), at any zoom. While the row's name is being renamed
 * it gives up all of it, so the field keeps the name's width.
 */
export function LabelChat({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-label-chat=""
      className="flex min-w-10 shrink-[1000000] [[data-chat-hidden]>&]:hidden [:has([data-editable-text=editing])>&]:min-w-0 [:has([data-editable-text=editing])>&]:overflow-hidden"
    >
      {children}
    </div>
  )
}

/**
 * Whether the row at `rowRef` has no room for its `LabelChat`: the rest of the
 * row at full width, plus the chat at its narrowest, is wider than the Layer
 * on screen. The row sets `data-chat-hidden` from it.
 */
export function useLabelChatHidden(
  rowRef: RefObject<HTMLElement | null>
): boolean {
  const { width, zoom, compact } = useContext(LabelFitContext)
  const labelLayer = useContext(LabelLayerContext)
  const [needed, setNeeded] = useState(0)
  // Labels keep one screen size, so zooming changes only the room they have.
  // The rest is measured when the row changes size (a font loading), content
  // (a rename, a menu showing) or goes compact (its menu hiding).
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    const measure = () => setNeeded(widthBesideChat(row) + LABEL_CHAT_MIN_WIDTH)
    measure()
    const resizes = new ResizeObserver(measure)
    resizes.observe(row)
    const edits = new MutationObserver(measure)
    edits.observe(row, { subtree: true, childList: true, characterData: true })
    return () => {
      resizes.disconnect()
      edits.disconnect()
    }
  }, [rowRef, compact])
  const [hidden, setHidden] = useState(false)
  // On the canvas the room follows the live camera, like the label's own
  // position and width, so the chat goes as the Layer narrows mid-zoom, not
  // once the zoom settles. State changes only when the answer flips.
  useLayoutEffect(() => {
    const update = () => {
      const z = labelLayer ? labelLayer.camera.get().zoom : zoom
      setHidden(needed > width * z + 0.5)
    }
    update()
    return labelLayer?.camera.subscribe(update)
  }, [labelLayer, needed, width, zoom])
  return hidden
}

/**
 * The full width of a row's items other than its chat, each with the gap
 * beside it. A truncated name counts at its untruncated width.
 */
function widthBesideChat(row: HTMLElement): number {
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0
  let width = 0
  for (const child of row.children) {
    if (!(child instanceof HTMLElement)) continue
    if (child.hasAttribute("data-label-chat") || child.offsetWidth === 0)
      continue
    let clipped = child.scrollWidth - child.clientWidth
    for (const el of child.querySelectorAll<HTMLElement>("*"))
      clipped = Math.max(clipped, el.scrollWidth - el.clientWidth)
    width += child.offsetWidth + clipped + gap
  }
  return width
}
