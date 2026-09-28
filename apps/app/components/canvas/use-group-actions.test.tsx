// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { GroupMember } from "@/lib/types"
import type { CanvasSelection } from "@/components/canvas/use-canvas-selection"
import { makeHarness, seedGroup } from "@/test/canvas/harness"

import { useGroupActions } from "./use-group-actions"

const f = (id: string): GroupMember => ({ kind: "iframe-layer", id })

function setup() {
  const { ops, collections } = makeHarness()
  seedGroup(collections, "g1", [f("a"), f("b"), f("c")])
  seedGroup(collections, "g2", [f("d")])
  const { result } = renderHook(() =>
    useGroupActions({
      ops,
      collections,
      getViewportCenter: () => ({ cx: 0, cy: 0 }),
      rememberDocChat: () => {},
      selection: {
        removeGroupFromSelection: () => {},
      } as never as CanvasSelection,
    })
  )
  const ids = (groupId: string) =>
    collections.iframeLayerGroups.get(groupId)?.members?.map((m) => m.id)
  return { result, ids }
}

afterEach(cleanup)

describe("moveMember into a group", () => {
  // `index` is a gap in the target's members as the caller sees them, the
  // moving member still in place: 0 = before a, 3 = after c.
  it.each([
    ["a", 0, ["a", "b", "c"]],
    ["a", 1, ["a", "b", "c"]],
    ["a", 2, ["b", "a", "c"]],
    ["a", 3, ["b", "c", "a"]],
    ["c", 0, ["c", "a", "b"]],
    ["c", 2, ["a", "b", "c"]],
    ["b", 3, ["a", "c", "b"]],
  ])("same group: %s to gap %i", (id, index, expected) => {
    const { result, ids } = setup()

    act(() =>
      result.current.moveMember(f(id), {
        kind: "into-group",
        groupId: "g1",
        index,
      })
    )

    expect(ids("g1")).toEqual(expected)
  })

  it("takes a cross-group index as is", () => {
    const { result, ids } = setup()

    act(() =>
      result.current.moveMember(f("d"), {
        kind: "into-group",
        groupId: "g1",
        index: 1,
      })
    )

    expect(ids("g1")).toEqual(["a", "d", "b", "c"])
    expect(ids("g2")).toBeUndefined()
  })
})
