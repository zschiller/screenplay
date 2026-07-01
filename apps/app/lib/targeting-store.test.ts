import { describe, expect, it, vi } from "vitest"

import { targetingStore } from "@/lib/targeting-store"

// The Canvas → Composer eligibility channel (#619): the Canvas publishes which
// branches have an open frame, and a Composer reads `hasEligibleFrames` (with a
// subscription) to disable its target affordance. These pin the publish/notify
// contract: membership drives the boolean, and listeners fire only on real
// change so the Canvas's ~per-render publishes don't churn every Composer.

describe("targetingStore eligibility", () => {
  it("reports a branch as eligible once it's published, and not before", () => {
    expect(targetingStore.hasEligibleFrames("branch-x")).toBe(false)
    targetingStore.publishEligibleBranches(new Set(["branch-x"]))
    expect(targetingStore.hasEligibleFrames("branch-x")).toBe(true)
    expect(targetingStore.hasEligibleFrames("branch-y")).toBe(false)
    // Reset so later tests start clean.
    targetingStore.publishEligibleBranches(new Set())
  })

  it("notifies subscribers only when the set membership actually changes", () => {
    const listener = vi.fn()
    const unsubscribe = targetingStore.subscribeEligibility(listener)

    targetingStore.publishEligibleBranches(new Set(["a"]))
    expect(listener).toHaveBeenCalledTimes(1)

    // Same membership (fresh Set identity) → no notify.
    targetingStore.publishEligibleBranches(new Set(["a"]))
    expect(listener).toHaveBeenCalledTimes(1)

    // Real change → notify.
    targetingStore.publishEligibleBranches(new Set(["a", "b"]))
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    targetingStore.publishEligibleBranches(new Set())
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
