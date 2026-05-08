"use client"

import type { ReactNode } from "react"
import { groupGap } from "@/lib/artboard-layout"
import type {
  ArtboardData,
  ArtboardGroupData,
  DocumentLayerData,
  GroupMember,
} from "@/lib/types"

interface ArtboardGroupProps {
  group: ArtboardGroupData
  /**
   * Resolved members — already in `group.members` order, with the
   * width/height of the underlying artboard or document. The "+ frame"
   * placeholder copies the last member's size so it visually matches the
   * row regardless of which kind sits at the right edge.
   */
  members: GroupMember[]
  /** True when at least one artboard in this group is currently selected. */
  hasSelectedArtboard: boolean
  /** Called when the user clicks the trailing "+" placeholder. */
  onAddArtboard: (groupId: string) => void
  children: ReactNode
  /** Optional helpers used to size the trailing placeholder when present. */
  artboards?: ReadonlyMap<string, ArtboardData>
  documents?: ReadonlyMap<string, DocumentLayerData>
}

/**
 * Absolutely-positioned flex row that lays out a group's members. The group
 * itself owns the world `(x, y)`; each child is sized by its own
 * `width`/`height` and positioned implicitly by flex. The trailing
 * "add frame" affordance is a transparent click target — its visible
 * border is drawn by `SelectionOverlay` in screen-space so the stroke
 * stays crisp at any zoom.
 */
export function ArtboardGroup({
  group,
  members,
  hasSelectedArtboard,
  onAddArtboard,
  children,
  artboards,
  documents,
}: ArtboardGroupProps) {
  // Size the placeholder by the last member's bounds — could be an artboard
  // or a document, both have width/height. If the underlying data isn't in
  // the lookup maps yet, fall back to 0 (the placeholder just renders flat).
  const lastMember = members[members.length - 1]
  let placeholderWidth = 0
  let placeholderHeight = 0
  if (lastMember) {
    if (lastMember.kind === "artboard") {
      const ab = artboards?.get(lastMember.id)
      if (ab) {
        placeholderWidth = ab.width
        placeholderHeight = ab.height
      }
    } else if (lastMember.kind === "document") {
      const d = documents?.get(lastMember.id)
      if (d) {
        placeholderWidth = d.width
        placeholderHeight = d.height
      }
    }
  }

  return (
    <div
      data-artboard-group={group.id}
      className="absolute flex items-start"
      style={{
        left: group.x,
        top: group.y,
        gap: groupGap(group),
      }}
    >
      {children}
      {hasSelectedArtboard && lastMember && placeholderWidth > 0 && (
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
