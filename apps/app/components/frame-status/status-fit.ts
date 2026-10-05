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

function measure(block: HTMLElement): StatusParts {
  const part = (slot: string) =>
    block.querySelector<HTMLElement>(`[data-slot=${slot}]`)
  const description = part("empty-description")
  const actions = part("empty-content")
  const title = part("empty-title")
  const icon = part("empty-icon")
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
 * only when `contentKey` changes, since the block lays out at a fixed width.
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
  const apply = (z: number) => {
    const el = blockRef.current
    const p = parts.current
    if (!el || !p || !(width > 0) || !(height > 0) || !(z > 0)) return
    const tier = statusTier(p, width * z, height * z)
    if (el.dataset.tier !== tier) el.dataset.tier = tier
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
    el.dataset.tier = "full"
    parts.current = measure(el)
    applyRef.current(zoom)
    // Measure again once fonts land: the title's width depends on them.
    let live = true
    void document.fonts?.ready.then(() => {
      if (!live || !blockRef.current) return
      blockRef.current.dataset.tier = "full"
      parts.current = measure(blockRef.current)
      applyRef.current(zoom)
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

/**
 * The classes that hide a status block's parts by tier: put `STATUS_BLOCK` on
 * the block and each part's class on its part.
 */
export const STATUS_BLOCK =
  "group/status w-80 shrink-0 data-[tier=none]:invisible"
export const STATUS_HIDE = {
  description:
    "group-data-[tier=icon]/status:hidden group-data-[tier=no-description]/status:hidden group-data-[tier=title]/status:hidden",
  actions:
    "group-data-[tier=icon]/status:hidden group-data-[tier=title]/status:hidden",
  title: "group-data-[tier=icon]/status:hidden",
}
