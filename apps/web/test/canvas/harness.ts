import * as Y from "yjs"
import { createCanvasOps, type CanvasOps } from "@/lib/canvas/ops"
import { getRoomCollections, type RoomCollections } from "@/lib/yjs/schema"
import type { GroupMember, IframeLayerData } from "@/lib/types"

/**
 * Bare-`Y.Doc` harness for the Canvas Operations seam. Builds a real room
 * Y.Doc, its {@link RoomCollections}, and a {@link CanvasOps} with no React and
 * no Liveblocks — the whole point of the seam is that mutation logic runs
 * against a plain document. Slices 3–5 (#158–#160) reuse this and the
 * invariant sweep below.
 */
export function makeHarness(): {
  doc: Y.Doc
  collections: RoomCollections
  ops: CanvasOps
} {
  const doc = new Y.Doc()
  const collections = getRoomCollections(doc)
  const ops = createCanvasOps(collections)
  return { doc, collections, ops }
}

/** A minimal valid Iframe Layer record for seeding. */
export function baseLayer(
  id: string,
  overrides: Partial<IframeLayerData> = {},
): IframeLayerData {
  return { id, width: 400, height: 300, label: "Frame", iframeState: {}, ...overrides }
}

/** Seed a Group holding `members`, anchored at the origin. */
export function seedGroup(
  collections: RoomCollections,
  id: string,
  members: GroupMember[],
): void {
  collections.iframeLayerGroups.set(id, { id, name: id, x: 0, y: 0, members })
}

/**
 * Reusable invariant sweep: the ids of every *committed* Group that holds zero
 * Members. The Group invariant (CONTEXT.md) says this set is always empty
 * outside an open transaction, so tests assert `findEmptyGroups(...)` is `[]`
 * after any verb.
 */
export function findEmptyGroups(collections: RoomCollections): string[] {
  return collections.iframeLayerGroups
    .toArray()
    .filter((g) => (g.members?.length ?? 0) === 0)
    .map((g) => g.id)
}
