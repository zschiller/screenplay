import { describe, expect, it } from "vitest"
import {
  computeDeviceSnap,
  computeMergeSnap,
  computeMoveSnap,
  MERGE_SNAP_THRESHOLD,
  MOVE_SNAP_THRESHOLD_PX,
  SNAP_THRESHOLD_PX,
  type MergeSnapCandidate,
  type Rect,
} from "@/lib/canvas/snap"
import type { IframeLayerSizePreset } from "@/lib/iframe-layer-sizes"

// Plain fixtures — no React, no Y.Doc. The snap functions are pure, take the
// threshold as a parameter, and measure distances in *screen* pixels, so a
// zoom of 1 makes world deltas equal pixel deltas for easy boundary assertions.

describe("computeMoveSnap", () => {
  // Wide rects keep the mid/max edges far enough apart that only the left
  // edges fall within threshold, so a single guide is emitted.
  const rect: Rect = { x: 0, y: 0, width: 1000, height: 10 }

  it("aligns to a peer's left edge within threshold and emits the matching guide", () => {
    // Candidate's left edge sits 4px to the right of the dragged rect's left
    // edge; well inside the default 6px threshold. A different width keeps the
    // mid/max edges from also coinciding, so only the left edge emits a guide.
    const candidate: Rect = { x: 4, y: 5000, width: 600, height: 10 }

    const result = computeMoveSnap({ rect, candidates: [candidate], zoom: 1 })

    expect(result.snapDx).toBe(4)
    expect(result.snapDy).toBe(0)
    expect(result.guides).toHaveLength(1)
    const [guide] = result.guides
    expect(guide.axis).toBe("x")
    expect(guide.sourceKind).toBe("min")
    // Guide sits on the shared world x (the candidate's left edge).
    expect(guide.pos).toBe(4)
    // marks = perpendicular (y) extents of the snapped source then the
    // candidate, used to span the guide line and draw the × end-markers.
    expect(guide.marks).toEqual([
      [0, 10],
      [5000, 5010],
    ])
  })

  it("does not snap when every edge is beyond threshold", () => {
    const candidate: Rect = { x: 200, y: 5000, width: 1000, height: 10 }

    const result = computeMoveSnap({ rect, candidates: [candidate], zoom: 1 })

    expect(result.snapDx).toBe(0)
    expect(result.snapDy).toBe(0)
    expect(result.guides).toEqual([])
  })

  it("snaps at exactly the threshold but not just beyond it", () => {
    const threshold = MOVE_SNAP_THRESHOLD_PX // 6

    // Just below: delta 5.9px → snaps.
    expect(
      computeMoveSnap({
        rect,
        candidates: [{ x: threshold - 0.1, y: 5000, width: 1000, height: 10 }],
        zoom: 1,
      }).snapDx,
    ).toBeCloseTo(threshold - 0.1)

    // Exactly at the threshold (distPx <= thresholdPx) → still snaps.
    expect(
      computeMoveSnap({
        rect,
        candidates: [{ x: threshold, y: 5000, width: 1000, height: 10 }],
        zoom: 1,
      }).snapDx,
    ).toBe(threshold)

    // Just above: delta 6.1px → no snap, no guides.
    const above = computeMoveSnap({
      rect,
      candidates: [{ x: threshold + 0.1, y: 5000, width: 1000, height: 10 }],
      zoom: 1,
    })
    expect(above.snapDx).toBe(0)
    expect(above.guides).toEqual([])
  })

  it("scales the threshold with zoom (screen-pixel distances)", () => {
    // At 2× zoom a 4px world delta is 8 screen px — beyond the 6px threshold.
    const candidate: Rect = { x: 4, y: 5000, width: 1000, height: 10 }
    expect(
      computeMoveSnap({ rect, candidates: [candidate], zoom: 2 }).snapDx,
    ).toBe(0)
  })
})

describe("computeDeviceSnap", () => {
  // Single Desktop preset → only a portrait orientation, no landscape dupe.
  const preset: IframeLayerSizePreset = {
    id: "test-device",
    label: "Test Device",
    width: 400,
    height: 800,
    category: "Desktop",
  }

  it("clamps a corner resize to the nearest device size within threshold", () => {
    // Height already matches the preset; width is 6px over → distance 6px,
    // inside the 8px threshold.
    const result = computeDeviceSnap({
      edge: "se",
      rawWidth: 406,
      rawHeight: 800,
      zoom: 1,
      presets: [preset],
    })

    expect(result.width).toBe(400)
    expect(result.height).toBe(800)
    expect(result.snappedPresetId).toBe("test-device")
    expect(result.snappedOrientation).toBe("portrait")
  })

  it("snaps at exactly the threshold but not just beyond it", () => {
    const t = SNAP_THRESHOLD_PX // 8

    // Just below: 7px away → snaps.
    expect(
      computeDeviceSnap({
        edge: "se",
        rawWidth: preset.width + (t - 1),
        rawHeight: preset.height,
        zoom: 1,
        presets: [preset],
      }).snappedPresetId,
    ).toBe("test-device")

    // Exactly at the threshold (distancePx <= SNAP_THRESHOLD_PX) → snaps.
    expect(
      computeDeviceSnap({
        edge: "se",
        rawWidth: preset.width + t,
        rawHeight: preset.height,
        zoom: 1,
        presets: [preset],
      }).snappedPresetId,
    ).toBe("test-device")

    // Just above: 9px away → no snap. Still a candidate (within fade radius),
    // but the size stays raw and no preset is locked.
    const above = computeDeviceSnap({
      edge: "se",
      rawWidth: preset.width + (t + 1),
      rawHeight: preset.height,
      zoom: 1,
      presets: [preset],
    })
    expect(above.snappedPresetId).toBeNull()
    expect(above.width).toBe(preset.width + (t + 1))
    expect(above.candidates).toHaveLength(1)
  })

  it("only fires for corner drags, not single-edge drags", () => {
    const result = computeDeviceSnap({
      edge: "e",
      rawWidth: 406,
      rawHeight: 800,
      zoom: 1,
      presets: [preset],
    })

    expect(result.candidates).toEqual([])
    expect(result.width).toBe(406)
    expect(result.snappedPresetId).toBeNull()
  })
})

describe("computeMergeSnap", () => {
  // The dragged group always has two members; only its top-left corner
  // (rect.x / rect.y) drives detection, with width/height guarding against a
  // degenerate (zero-extent) source.
  const rect: Rect = { x: 0, y: 0, width: 100, height: 80 }
  const memberSizes = [
    { width: 50, height: 40 },
    { width: 60, height: 40 },
  ]

  // A candidate at the origin with width 100 and gap 20 → its trailing "+
  // frame" slot sits at world (120, 0).
  const candidate = (id: string, x: number, y: number): MergeSnapCandidate => ({
    id,
    rect: { x, y, width: 100, height: 80 },
    gap: 20,
  })

  it("goes hot and previews the merged row when the source sits on the slot", () => {
    // Source top-left exactly on the candidate's trailing slot (120, 0).
    const result = computeMergeSnap({
      rect: { ...rect, x: 120, y: 0 },
      memberSizes,
      candidates: [candidate("target", 0, 0)],
    })

    expect(result).not.toBeNull()
    expect(result!.targetId).toBe("target")
    // One rect per member, laid out from the slot with the target's 20px gap:
    // first at the slot, second at 120 + 50 + 20 = 190.
    expect(result!.rects).toEqual([
      { x: 120, y: 0, width: 50, height: 40 },
      { x: 190, y: 0, width: 60, height: 40 },
    ])
  })

  it("picks the nearest target among several", () => {
    // Source at (120, 30). The "near" slot is at (120, 0) → 30 away; the "far"
    // slot is at (120, 100) → 70 away. Both are within the default radius, so
    // the tie-break is pure distance.
    const result = computeMergeSnap({
      rect: { ...rect, x: 120, y: 30 },
      candidates: [candidate("far", 0, 100), candidate("near", 0, 0)],
      memberSizes,
    })

    expect(result!.targetId).toBe("near")
  })

  it("stays cold when every target is beyond threshold", () => {
    // Source is 300 world units below the only slot — outside the default 150.
    const result = computeMergeSnap({
      rect: { ...rect, x: 120, y: 300 },
      candidates: [candidate("target", 0, 0)],
      memberSizes,
    })

    expect(result).toBeNull()
  })

  it("goes hot just below the threshold but not at or beyond it", () => {
    const threshold = 100
    // Slot is at (120, 0); push the source down the y axis so distance == |dy|.
    const at = (dy: number) =>
      computeMergeSnap({
        rect: { ...rect, x: 120, y: dy },
        candidates: [candidate("target", 0, 0)],
        memberSizes,
        threshold,
      })

    // Just below → hot.
    expect(at(threshold - 0.1)?.targetId).toBe("target")
    // Exactly at the threshold → cold (detection uses a strict `<`).
    expect(at(threshold)).toBeNull()
    // Just above → cold.
    expect(at(threshold + 0.1)).toBeNull()
  })

  it("uses MERGE_SNAP_THRESHOLD as the default radius", () => {
    // Just inside the default radius along y.
    expect(
      computeMergeSnap({
        rect: { ...rect, x: 120, y: MERGE_SNAP_THRESHOLD - 1 },
        candidates: [candidate("target", 0, 0)],
        memberSizes,
      })?.targetId,
    ).toBe("target")
    // Just outside it.
    expect(
      computeMergeSnap({
        rect: { ...rect, x: 120, y: MERGE_SNAP_THRESHOLD + 1 },
        candidates: [candidate("target", 0, 0)],
        memberSizes,
      }),
    ).toBeNull()
  })

  it("returns null for a degenerate (zero-extent) source", () => {
    expect(
      computeMergeSnap({
        rect: { x: 120, y: 0, width: 0, height: 0 },
        candidates: [candidate("target", 0, 0)],
        memberSizes,
      }),
    ).toBeNull()
  })

  it("returns null when there are no candidates", () => {
    expect(
      computeMergeSnap({ rect, candidates: [], memberSizes }),
    ).toBeNull()
  })
})
