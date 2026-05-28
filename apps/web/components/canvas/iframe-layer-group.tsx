"use client"

import type { ReactNode } from "react"
import { groupGap } from "@/lib/iframe-layer-layout"
import type {
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
  GroupMember,
} from "@/lib/types"

interface IframeLayerGroupProps {
  group: IframeLayerGroupData
  /**
   * Resolved members — already in `group.members` order, with the
   * width/height of the underlying iframeLayer or document. The "+ frame"
   * placeholder copies the last member's size so it visually matches the
   * row regardless of which kind sits at the right edge.
   */
  members: GroupMember[]
  /** True when at least one iframeLayer in this group is currently selected. */
  hasSelectedIframeLayer: boolean
  /** Called when the user clicks the trailing "+" placeholder. */
  onAddIframeLayer: (groupId: string) => void
  children: ReactNode
  /** Optional helpers used to size the trailing placeholder when present. */
  iframeLayers?: ReadonlyMap<string, IframeLayerData>
  markdownLayers?: ReadonlyMap<string, MarkdownLayerData>
  /**
   * Stacking position derived from the group's row in the sidebar — higher
   * value paints on top. Set on the wrapper so each group becomes its own
   * stacking context, scoping any inner z-index (drag-pop, overlays) to its
   * own subtree.
   */
  zIndex?: number
}

/**
 * Absolutely-positioned flex row that lays out a group's members. The group
 * itself owns the world `(x, y)`; each child is sized by its own
 * `width`/`height` and positioned implicitly by flex. The trailing
 * "add frame" affordance is a transparent click target — its visible
 * border is drawn by `SelectionOverlay` in screen-space so the stroke
 * stays crisp at any zoom.
 */
export function IframeLayerGroup({
  group,
  members,
  hasSelectedIframeLayer,
  onAddIframeLayer,
  children,
  iframeLayers,
  markdownLayers,
  zIndex,
}: IframeLayerGroupProps) {
  // Size the placeholder by the last member's bounds — could be an iframeLayer
  // or a document, both have width/height. If the underlying data isn't in
  // the lookup maps yet, fall back to 0 (the placeholder just renders flat).
  const lastMember = members[members.length - 1]
  let placeholderWidth = 0
  let placeholderHeight = 0
  if (lastMember) {
    if (lastMember.kind === "iframe-layer") {
      const ab = iframeLayers?.get(lastMember.id)
      if (ab) {
        placeholderWidth = ab.width
        placeholderHeight = ab.height
      }
    } else if (lastMember.kind === "markdown-layer") {
      const d = markdownLayers?.get(lastMember.id)
      if (d) {
        placeholderWidth = d.width
        placeholderHeight = d.height
      }
    }
  }

  return (
    <div
      data-iframe-layer-group={group.id}
      className="absolute flex items-start"
      style={{
        left: group.x,
        top: group.y,
        gap: groupGap(group),
        zIndex,
        // Empty interior space (the gap between members, or the area below a
        // shorter member in a "T"-shape group) shouldn't trap clicks — pass
        // them through to whatever sits beneath. Members and the trailing
        // "+ frame" placeholder are direct children with the default
        // `pointer-events: auto`, so they still catch their own events.
        pointerEvents: "none",
      }}
    >
      {children}
      {hasSelectedIframeLayer && lastMember && placeholderWidth > 0 && (
        <button
          type="button"
          data-iframe-layer-placeholder
          className="shrink-0 cursor-pointer bg-transparent"
          // High flex order so the placeholder always renders last visually,
          // even when iframeLayers are placed via CSS `order` rather than DOM order.
          style={{ width: placeholderWidth, height: placeholderHeight, order: 9999, pointerEvents: "auto" }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onAddIframeLayer(group.id)
          }}
          aria-label="Add frame to group"
        />
      )}
    </div>
  )
}
