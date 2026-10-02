"use client"

import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { FloatingToolbar } from "@workspace/ui/components/floating-toolbar"
import { InputGroupText } from "@workspace/ui/components/input-group"

import {
  Composer,
  type ComposerSubmitPayload,
} from "@/components/agent/composer"
import type { MarkdownLayerData } from "@/lib/types"

/** Keeps the card clear of the canvas edges and the bottom tool toolbar. */
const INSET = 8
const CANVAS_TOOLBAR_STRIP = 48

/**
 * Marks a popup a composer opens outside the card (the `@` and `/` pickers),
 * so a pointer-down in it doesn't count as clicking away.
 */
export const COMPOSER_POPUP_ATTRIBUTE = "data-composer-popup"

/**
 * The ask a drawn frame opens (#1356, spec #1355): the chat composer on the
 * shared floating surface, centred on the frame in screen space, so it reads
 * the same at any zoom. A chip where the model pill sits says who answers
 * (New chat for now), and the turn uses the default model.
 *
 * Per-viewer: the canvas holds which frame is asking in local state, never in
 * the room doc. Enter sends; Esc or a pointer-down outside closes it, leaving
 * the frame as it is.
 */
export function FrameAskCard({
  frameId,
  markdownLayers,
  onSubmit,
  onClose,
}: {
  frameId: string
  markdownLayers: MarkdownLayerData[]
  onSubmit: (payload: ComposerSubmitPayload) => void
  onClose: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Centre the card on the frame every frame, the way the frame bar follows
  // its frame: the frame lives inside the world transform, the card in screen
  // space. Hidden until the frame has mounted and the card is placed.
  useEffect(() => {
    const wrapper = document.querySelector<HTMLElement>("[data-canvas-wrapper]")
    if (!wrapper) return
    let rafId = 0
    const tick = () => {
      const frame = document.getElementById(`iframe-layer-${frameId}`)
      const card = cardRef.current
      if (frame && card) {
        const fr = frame.getBoundingClientRect()
        const cw = wrapper.getBoundingClientRect()
        const w = card.offsetWidth
        const h = card.offsetHeight
        const x = fr.left - cw.left + (fr.width - w) / 2
        const y = fr.top - cw.top + (fr.height - h) / 2
        const clampedX = Math.max(INSET, Math.min(x, cw.width - w - INSET))
        const clampedY = Math.max(
          INSET,
          Math.min(y, cw.height - CANVAS_TOOLBAR_STRIP - h)
        )
        card.style.transform = `translate(${clampedX}px, ${clampedY}px)`
        card.style.visibility = "visible"
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [frameId])

  // A pointer-down anywhere but the card (or a picker it opened) closes it.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (cardRef.current?.contains(target)) return
      if (
        target instanceof Element &&
        target.closest(`[${COMPOSER_POPUP_ATTRIBUTE}]`)
      )
        return
      onCloseRef.current()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true)
  }, [])

  const portal =
    typeof document !== "undefined"
      ? document.getElementById("frame-toolbar-portal")
      : null
  if (!portal) return null

  return createPortal(
    <FloatingToolbar
      ref={cardRef}
      role="dialog"
      aria-label="What should this frame show?"
      className="invisible absolute top-0 left-0 block w-88 max-w-[calc(100%-1rem)] p-1"
      // React bubbles a portal's events up its owner tree, through the
      // canvas's gesture handlers; the card is not the canvas.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      // Caught on the way down: the composer claims Esc for itself (it lets
      // go of focus). An open `@` or `/` picker still takes it first.
      onKeyDownCapture={(e) => {
        if (e.key !== "Escape") return
        if (document.querySelector(`[${COMPOSER_POPUP_ATTRIBUTE}]`)) return
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }}
    >
      <Composer
        markdownLayers={markdownLayers}
        onModelChange={() => {}}
        onSubmit={onSubmit}
        focusKey={1}
        placeholder="What should this frame show?"
        modelSlot={
          <InputGroupText className="h-6 text-xs font-medium text-foreground">
            New chat
          </InputGroupText>
        }
        // The card is the surface: the composer's own box goes borderless.
        className="relative [&_[data-slot=input-group]]:border-transparent dark:[&_[data-slot=input-group]]:bg-transparent"
      />
    </FloatingToolbar>,
    portal
  )
}
