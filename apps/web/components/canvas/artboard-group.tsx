"use client"

import type { ReactNode } from "react"
import { ARTBOARD_GROUP_GAP } from "@/lib/constants"
import type { ArtboardData, ArtboardGroupData } from "@/lib/liveblocks.types"

interface ArtboardGroupProps {
  group: ArtboardGroupData
  /** Artboards belonging to this group, already ordered by `artboardIds`. */
  artboards: ArtboardData[]
  /** True when at least one artboard in this group is currently selected. */
  hasSelectedArtboard: boolean
  /** Called when the user clicks the trailing "+" placeholder. */
  onAddArtboard: (groupId: string) => void
  children: ReactNode
}

/**
 * Absolutely-positioned flex row that lays out a group's artboards. The group
 * itself owns the world `(x, y)`; each child artboard is sized by its own
 * `width`/`height` and positioned implicitly by flex. The trailing "add frame"
 * affordance is a transparent click target — its visible border is drawn by
 * `SelectionOverlay` in screen-space so the stroke stays crisp at any zoom.
 */
export function ArtboardGroup({
  group,
  artboards,
  hasSelectedArtboard,
  onAddArtboard,
  children,
}: ArtboardGroupProps) {
  const last = artboards[artboards.length - 1]
  const placeholderWidth = last?.width ?? 0
  const placeholderHeight = last?.height ?? 0

  return (
    <div
      data-artboard-group={group.id}
      className="absolute flex items-start"
      style={{
        left: group.x,
        top: group.y,
        gap: ARTBOARD_GROUP_GAP,
      }}
    >
      {children}
      {hasSelectedArtboard && last && (
        <button
          type="button"
          data-artboard-placeholder
          className="shrink-0 cursor-pointer bg-transparent"
          // High flex order so the placeholder always renders last visually,
          // even when artboards are placed via CSS `order` rather than DOM order.
          style={{ width: placeholderWidth, height: placeholderHeight, order: 9999 }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onAddArtboard(group.id)
          }}
          aria-label="Add frame to group"
        />
      )}
    </div>
  )
}
