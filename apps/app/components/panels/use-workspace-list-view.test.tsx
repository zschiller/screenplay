// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { useWorkspaceListView } from "@/components/panels/use-workspace-list-view"
import { DEFAULT_WORKSPACE_LIST_VIEW } from "@/lib/workspace-list-view"

describe("useWorkspaceListView", () => {
  afterEach(() => window.localStorage.clear())

  it("starts at manual order, ungrouped", () => {
    const { result } = renderHook(() => useWorkspaceListView("u1", "r1"))
    expect(result.current[0]).toEqual(DEFAULT_WORKSPACE_LIST_VIEW)
  })

  it("keeps the choice across a reload, for this user and canvas only", () => {
    const first = renderHook(() => useWorkspaceListView("u1", "r1"))
    act(() => first.result.current[1]({ sort: "recent", groupByState: true }))
    first.unmount()

    const again = renderHook(() => useWorkspaceListView("u1", "r1"))
    expect(again.result.current[0]).toMatchObject({
      sort: "recent",
      groupByState: true,
    })
    const otherCanvas = renderHook(() => useWorkspaceListView("u1", "r2"))
    expect(otherCanvas.result.current[0]).toEqual(DEFAULT_WORKSPACE_LIST_VIEW)
    const collaborator = renderHook(() => useWorkspaceListView("u2", "r1"))
    expect(collaborator.result.current[0]).toEqual(DEFAULT_WORKSPACE_LIST_VIEW)
  })

  it("is stored in this browser under its own key, not in the room", () => {
    // The hook has no room doc to write: the whole view is one local entry.
    const { result } = renderHook(() => useWorkspaceListView("u1", "r1"))
    act(() => result.current[1]({ sort: "name", collapsed: ["idle"] }))
    expect(Object.keys(window.localStorage)).toEqual([
      "workspace-list-view:u1:r1",
    ])
  })
})
