import { describe, expect, it } from "vitest"

import { planBranchThreadMoves } from "./comment-migration"

describe("planBranchThreadMoves", () => {
  it("moves each feed thread onto the Workspace on its branch", () => {
    expect(
      planBranchThreadMoves(
        [
          { id: "t1", branch: "checkout-polish" },
          { id: "t2", branch: "empty-cart" },
        ],
        [
          { id: "ws1", ref: "checkout-polish" },
          { id: "ws2", ref: "empty-cart" },
        ]
      )
    ).toEqual([
      { threadId: "t1", workspaceId: "ws1", snapshot: null },
      { threadId: "t2", workspaceId: "ws2", snapshot: null },
    ])
  })

  it("keeps an orphan listable with the branch it was on", () => {
    expect(
      planBranchThreadMoves([{ id: "t1", branch: "renamed-away" }], [])
    ).toEqual([
      {
        threadId: "t1",
        workspaceId: null,
        snapshot: "Play mode on renamed-away",
      },
    ])
  })

  it("gives a shared ref to the first Workspace listed", () => {
    expect(
      planBranchThreadMoves(
        [{ id: "t1", branch: "main" }],
        [
          { id: "old", ref: "main" },
          { id: "new", ref: "main" },
        ]
      )[0]?.workspaceId
    ).toBe("old")
  })
})
