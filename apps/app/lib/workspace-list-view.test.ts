// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import {
  roomWorkspaceFacts,
  workspaceState,
} from "@/lib/branch/workspace-state"
import type { BranchData } from "@/lib/types"
import {
  DEFAULT_WORKSPACE_LIST_VIEW,
  canDragWorkspaces,
  groupWorkspaces,
  parseWorkspaceListView,
  readWorkspaceListView,
  sortWorkspaces,
  workspaceListViewKey,
  writeWorkspaceListView,
  type WorkspaceListView,
} from "@/lib/workspace-list-view"

function ws(id: string, patch: Partial<BranchData> = {}): BranchData {
  return {
    id,
    ref: id,
    status: "running",
    createdAt: 0,
    ...patch,
  } as BranchData
}

describe("sortWorkspaces", () => {
  const list = [
    ws("b", { title: "beta", createdAt: 1, lastActivityAt: 10 }),
    ws("a", { title: "Alpha", createdAt: 2 }),
    ws("c", { title: "gamma 10", createdAt: 30 }),
    ws("d", { title: "gamma 9", createdAt: 3, lastActivityAt: 20 }),
  ]

  it("keeps manual order as given", () => {
    expect(sortWorkspaces(list, "manual").map((b) => b.id)).toEqual([
      "b",
      "a",
      "c",
      "d",
    ])
  })

  it("orders by the last turn, newest first, falling back to creation", () => {
    expect(sortWorkspaces(list, "recent").map((b) => b.id)).toEqual([
      "c",
      "d",
      "b",
      "a",
    ])
  })

  it("orders by title, ignoring case and reading numbers as numbers", () => {
    expect(sortWorkspaces(list, "name").map((b) => b.id)).toEqual([
      "a",
      "b",
      "d",
      "c",
    ])
  })

  it("sorts an untitled Workspace by its branch name", () => {
    const named = [ws("zeta"), ws("x", { title: "Middle" })]
    expect(sortWorkspaces(named, "name").map((b) => b.id)).toEqual([
      "x",
      "zeta",
    ])
  })
})

describe("groupWorkspaces", () => {
  it("returns non-empty sections in order, each in the view's sort", () => {
    const list = [
      ws("z", { title: "Zed" }),
      ws("f", { status: "error" }),
      ws("w", { title: "Working" }),
      ws("a", { title: "Apple" }),
    ]
    const room = roomWorkspaceFacts([{ branchId: "w", isStreaming: true }], [])
    const groups = groupWorkspaces(
      list,
      "name",
      (b) => workspaceState(b, room).section
    )
    expect(groups.map((g) => [g.section, g.branches.map((b) => b.id)])).toEqual(
      [
        ["working", ["w"]],
        ["needs-you", ["f"]],
        ["idle", ["a", "z"]],
      ]
    )
  })
})

describe("canDragWorkspaces", () => {
  it("drags only in the ungrouped manual list", () => {
    expect(canDragWorkspaces(DEFAULT_WORKSPACE_LIST_VIEW)).toBe(true)
    expect(
      canDragWorkspaces({ ...DEFAULT_WORKSPACE_LIST_VIEW, sort: "name" })
    ).toBe(false)
    expect(
      canDragWorkspaces({ ...DEFAULT_WORKSPACE_LIST_VIEW, groupByState: true })
    ).toBe(false)
  })
})

describe("parseWorkspaceListView", () => {
  it("falls back to the default for missing or broken values", () => {
    expect(parseWorkspaceListView(null)).toEqual(DEFAULT_WORKSPACE_LIST_VIEW)
    expect(parseWorkspaceListView("{")).toEqual(DEFAULT_WORKSPACE_LIST_VIEW)
    expect(
      parseWorkspaceListView(
        JSON.stringify({ sort: "size", groupByState: "yes" })
      )
    ).toEqual(DEFAULT_WORKSPACE_LIST_VIEW)
  })

  it("keeps known values", () => {
    const view = {
      sort: "recent",
      groupByState: true,
    } as const
    expect(parseWorkspaceListView(JSON.stringify(view))).toEqual(view)
  })
})

describe("stored view", () => {
  afterEach(() => window.localStorage.clear())

  it("persists per user per canvas in this browser", () => {
    const view: WorkspaceListView = {
      sort: "name",
      groupByState: true,
    }
    writeWorkspaceListView("user_1", "room_1", view)
    expect(readWorkspaceListView("user_1", "room_1")).toEqual(view)
    expect(readWorkspaceListView("user_1", "room_2")).toEqual(
      DEFAULT_WORKSPACE_LIST_VIEW
    )
    expect(readWorkspaceListView("user_2", "room_1")).toEqual(
      DEFAULT_WORKSPACE_LIST_VIEW
    )
    expect(
      window.localStorage.getItem(workspaceListViewKey("user_1", "room_1"))
    ).not.toBeNull()
  })
})
