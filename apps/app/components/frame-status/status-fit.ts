"use client"

import { useLayoutEffect, useRef, type RefObject } from "react"

import { useLiveZoom } from "@/components/canvas/live-zoom"

/** Clear space kept between a status block and its layer's edges, on screen. */
export const STATUS_EDGE = 24
/** The icon alone needs less room: it keeps this much clear space instead. */
const ICON_EDGE = 8

/**
 * How much of a status block shows. A layer too small on screen for the whole
 * block drops its parts in this order rather than shrinking it, so every
 * status block on the canvas reads at the same size.
 */
export type StatusTier = "full" | "no-description" | "title" | "icon" | "none"

/** A status block's parts at their UI size, measured with every part showing. */
export interface StatusParts {
  width: number
  height: number
  /** The description's height plus the gap above it. */
  description: number
  /** The buttons' height plus the gap above them. */
  actions: number
  /** The widest of what stays once the description goes: title, buttons. */
  bareWidth: number
  icon: number
}

/** The most of the block that fits a layer `width` × `height` on screen. */
export function statusTier(
  parts: StatusParts,
  width: number,
  height: number
): StatusTier {
  const w = width - 2 * STATUS_EDGE
  const h = height - 2 * STATUS_EDGE
  if (parts.width <= w && parts.height <= h) return "full"
  const noDescription = parts.height - parts.description
  if (parts.bareWidth <= w && noDescription <= h) return "no-description"
  if (parts.bareWidth <= w && noDescription - parts.actions <= h) return "title"
  if (
    parts.icon <= width - 2 * ICON_EDGE &&
    parts.icon <= height - 2 * ICON_EDGE
  )
    return "icon"
  return "none"
}

const part = (block: HTMLElement, slot: string) =>
  block.querySelector<HTMLElement>(`[data-slot=${slot}]`)

/**
 * Shows the parts `tier` keeps and hides the rest, on the parts themselves.
 * Classes keyed on the block's `data-tier` (`group-data-[tier=…]`) leaned on
 * the engine restyling every part when that attribute changed, and on the
 * desktop app's WebKit the parts stayed put as the zoom changed; `hidden` on
 * the part itself needs no such restyle.
 */
function showTier(block: HTMLElement, tier: StatusTier) {
  if (block.dataset.tier !== tier) block.dataset.tier = tier
  const hide = (slot: string, hidden: boolean) => {
    const el = part(block, slot)
    if (el && el.hidden !== hidden) el.hidden = hidden
  }
  hide("empty-description", tier !== "full")
  hide("empty-content", tier !== "full" && tier !== "no-description")
  hide("empty-title", tier === "icon" || tier === "none")
  const visibility = tier === "none" ? "hidden" : ""
  if (block.style.visibility !== visibility) block.style.visibility = visibility
}

/** Measures the block with every part showing; null while it has no layout. */
function measure(block: HTMLElement): StatusParts | null {
  showTier(block, "full")
  if (!block.offsetWidth || !block.offsetHeight) return null
  const description = part(block, "empty-description")
  const actions = part(block, "empty-content")
  const title = part(block, "empty-title")
  const icon = part(block, "empty-icon")
  return {
    width: block.offsetWidth,
    height: block.offsetHeight,
    // The header's gap-2 and the block's gap-3 sit above each.
    description: description ? description.offsetHeight + 8 : 0,
    actions: actions ? actions.offsetHeight + 12 : 0,
    bareWidth: Math.max(title?.offsetWidth ?? 0, actions?.offsetWidth ?? 0),
    icon: icon?.offsetHeight ?? 0,
  }
}

/**
 * Keeps a layer's status block at UI size at every zoom, like the layer's
 * label: it counter-scales by 1/zoom about the layer's centre, and drops the
 * parts that no longer fit (see `statusTier`) instead of shrinking. It follows
 * the live zoom through a gesture, so it never jumps; the parts are measured
 * only when `contentKey` changes, since the block lays out at a fixed width,
 * or on the next zoom if the block had no layout then.
 *
 * Without a layer size (the prototype player) the block shows whole at 1:1.
 */
export function useStatusFit(
  blockRef: RefObject<HTMLElement | null>,
  {
    zoom,
    width,
    height,
    contentKey,
  }: { zoom: number; width: number; height: number; contentKey: string }
) {
  const parts = useRef<StatusParts | null>(null)
  const lastZoom = useRef(zoom)
  const apply = (z: number) => {
    lastZoom.current = z
    const el = blockRef.current
    if (!el || !(width > 0) || !(height > 0) || !(z > 0)) return
    // Measured before the block had layout: the parts would all read 0 and
    // every tier would fit, so measure again now.
    const p = (parts.current ??= measure(el))
    if (p) showTier(el, statusTier(p, width * z, height * z))
    const transform = z === 1 ? "" : `scale(${1 / z})`
    if (el.style.transform !== transform) el.style.transform = transform
  }
  const applyRef = useRef(apply)
  useLayoutEffect(() => {
    applyRef.current = apply
  })

  useLayoutEffect(() => {
    const el = blockRef.current
    if (!el) return
    parts.current = measure(el)
    applyRef.current(zoom)
    // Measure again once fonts land: the title's width depends on them.
    let live = true
    void document.fonts?.ready.then(() => {
      if (!live || !blockRef.current) return
      parts.current = measure(blockRef.current)
      applyRef.current(lastZoom.current)
    })
    return () => {
      live = false
    }
    // The block's size changes only with its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey])

  useLayoutEffect(() => {
    applyRef.current(zoom)
  }, [zoom, width, height])

  useLiveZoom((live) => applyRef.current(live))
}

/** The block's layout: a fixed width, so it never wraps to the layer's. */
export const STATUS_BLOCK = "w-80 shrink-0"
