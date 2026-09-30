import type { SizedLayer } from "@/lib/canvas/layout"
import type { RoomCollections } from "@/lib/yjs/schema"
import type { GroupMember } from "@/lib/types"

/**
 * Every non-frame Layer in the Room (Markdown and Mockup Layers), as the one
 * list the layout helpers in `lib/canvas/layout.ts` take beside the frames.
 */
export function sizedLayersOf(
  collections: Pick<RoomCollections, "markdownLayers" | "mockupLayers">
): SizedLayer[] {
  return [
    ...collections.markdownLayers.toArray(),
    ...collections.mockupLayers.toArray(),
  ]
}

/** A Member's box, read from its kind's collection; `undefined` if missing. */
export function memberBox(
  collections: Pick<
    RoomCollections,
    "iframeLayers" | "markdownLayers" | "mockupLayers"
  >,
  member: GroupMember
): { width: number; height: number } | undefined {
  switch (member.kind) {
    case "iframe-layer":
      return collections.iframeLayers.get(member.id)
    case "markdown-layer":
      return collections.markdownLayers.get(member.id)
    case "mockup-layer":
      return collections.mockupLayers.get(member.id)
  }
}
