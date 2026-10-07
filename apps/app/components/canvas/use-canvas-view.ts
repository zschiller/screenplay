import { useEffect, useRef, type RefObject } from "react"

import {
  canvasViewSource,
  describeCanvasView,
  layersOnScreen,
  type CanvasViewRecords,
} from "@/lib/canvas/canvas-view"
import type { SelectionSnapshot } from "@/lib/canvas/selection"

/**
 * Registers this Canvas as the chat's Canvas View source: when the member sends
 * a message, the chat reads their selection and the layers on their screen
 * (`lib/canvas/canvas-view.ts`). Everything is read at that moment from the
 * latest values, so panning and selecting cost nothing here.
 */
export function useCanvasView(deps: {
  canvasWrapperRef: RefObject<HTMLDivElement | null>
  /** The selection as it stands now (the controller's `current()`). */
  currentSelection: () => SelectionSnapshot
  records: CanvasViewRecords
  sender?: string
  /** The page this member is on, on a canvas with more than one (#1842). */
  page?: { id: string; name: string }
}): void {
  const latest = useRef(deps)
  useEffect(() => {
    latest.current = deps
  })

  useEffect(
    () =>
      canvasViewSource.register(() => {
        const { canvasWrapperRef, currentSelection, records, sender, page } =
          latest.current
        const selection = currentSelection()
        const wrapper = canvasWrapperRef.current
        const onScreenIds = wrapper
          ? layersOnScreen(
              [...wrapper.querySelectorAll<HTMLElement>("[data-layer-id]")].map(
                (el) => ({
                  id: el.dataset.layerId ?? "",
                  rect: el.getBoundingClientRect(),
                })
              ),
              wrapper.getBoundingClientRect()
            )
          : []
        return describeCanvasView({
          sender,
          page,
          selectedGroupIds: selection.groupIds,
          selectedLayerIds: [
            ...selection.iframeLayerIds,
            ...selection.markdownLayerIds,
          ],
          onScreenIds,
          records,
        })
      }),
    []
  )
}
