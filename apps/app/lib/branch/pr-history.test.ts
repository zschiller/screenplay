import { describe, expect, it } from "vitest"

import {
  branchPrList,
  prCacheUpdate,
  type BranchPrCache,
} from "@/lib/branch/pr-history"

const url = (n: number) => `https://github.com/a/b/pull/${n}`
const pr = (
  number: number,
  state: "open" | "closed" | "merged",
  title?: string
) => ({ number, url: url(number), state, ...(title ? { title } : {}) })

/** Applies `prCacheUpdate`'s patch, the way the doc would. */
function apply(
  cur: BranchPrCache,
  ...args: Parameters<typeof prCacheUpdate> extends [unknown, ...infer R]
    ? R
    : never
): BranchPrCache {
  return { ...cur, ...prCacheUpdate(cur, ...args) }
}

describe("prCacheUpdate (#1701)", () => {
  it("records a Branch's first PR as its current one", () => {
    expect(prCacheUpdate({}, pr(482, "open", "One-scroll checkout"))).toEqual({
      prNumber: 482,
      prUrl: url(482),
      prState: "open",
      prBlocked: undefined,
      prTitle: "One-scroll checkout",
    })
  })

  it("writes nothing when the cache already says so", () => {
    const cur = apply({}, pr(482, "merged", "One-scroll checkout"))
    expect(prCacheUpdate(cur, pr(482, "merged", "One-scroll checkout"))).toBe(
      null
    )
  })

  it("moves the current PR into the past PRs when a new one opens", () => {
    const merged = apply({}, pr(482, "merged", "One-scroll checkout"))
    const next = apply(merged, pr(497, "open", "Apple Pay"))
    expect(next).toMatchObject({
      prNumber: 497,
      prState: "open",
      prTitle: "Apple Pay",
      pastPrs: [pr(482, "merged", "One-scroll checkout")],
    })
  })

  it("keeps past PRs newest first", () => {
    let cur = apply({}, pr(1, "merged", "First"))
    cur = apply(cur, pr(2, "closed", "Second"))
    cur = apply(cur, pr(3, "open", "Third"))
    expect(cur.pastPrs).toEqual([
      pr(2, "closed", "Second"),
      pr(1, "merged", "First"),
    ])
  })

  it("never lets a lagging poll's older PR replace a newer current one", () => {
    // Opened optimistically; GitHub's list still shows the merged one.
    let cur = apply({}, pr(482, "open", "One-scroll checkout"))
    cur = apply(cur, pr(497, "open"))
    const lagging = prCacheUpdate(cur, pr(482, "merged", "One-scroll checkout"))
    expect(lagging).toEqual({
      pastPrs: [pr(482, "merged", "One-scroll checkout")],
    })
  })

  it("refreshes past PRs from the Branch's other PRs on GitHub", () => {
    // Moved while the poll still thought it was open.
    let cur = apply({}, pr(482, "open", "One-scroll checkout"))
    cur = apply(cur, pr(497, "open", "Apple Pay"))
    expect(cur.pastPrs).toEqual([pr(482, "open", "One-scroll checkout")])
    const patch = prCacheUpdate(cur, pr(497, "open", "Apple Pay"), [
      pr(482, "merged", "One-scroll checkout"),
    ])
    expect(patch).toEqual({
      pastPrs: [pr(482, "merged", "One-scroll checkout")],
    })
  })

  it("keeps a title the lookup didn't send", () => {
    const cur = apply({}, pr(482, "open", "One-scroll checkout"))
    expect(prCacheUpdate(cur, pr(482, "merged"))).toMatchObject({
      prState: "merged",
      prTitle: "One-scroll checkout",
    })
  })
})

describe("branchPrList (#1701)", () => {
  it("lists the current PR, then the past ones, newest first", () => {
    let cur = apply({}, pr(482, "merged", "One-scroll checkout"))
    cur = apply(cur, pr(497, "open", "Apple Pay"))
    expect(branchPrList(cur)).toEqual([
      pr(497, "open", "Apple Pay"),
      pr(482, "merged", "One-scroll checkout"),
    ])
  })

  it("leads with a PR a chat just opened that the poll hasn't seen", () => {
    const cur = apply({}, pr(482, "merged", "One-scroll checkout"))
    expect(branchPrList(cur, pr(497, "open"))).toEqual([
      pr(497, "open"),
      pr(482, "merged", "One-scroll checkout"),
    ])
  })

  it("lists nothing for a Branch with no PR", () => {
    expect(branchPrList({})).toEqual([])
  })
})
