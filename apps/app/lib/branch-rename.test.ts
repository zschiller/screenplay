import { describe, expect, it } from "vitest"

import { checkBranchRename, sanitizeBranchName } from "@/lib/branch-rename"

describe("sanitizeBranchName", () => {
  it("lowercases and hyphenates a typed name", () => {
    expect(sanitizeBranchName("  Hero Trust Line! ")).toBe("hero-trust-line")
    expect(sanitizeBranchName("feat/Pricing_FAQ")).toBe("feat/pricing_faq")
  })
})

describe("checkBranchRename", () => {
  it("renames to the sanitized name", () => {
    expect(
      checkBranchRename({ next: "Hero Trust", current: "hero-gradient" })
    ).toEqual({ kind: "rename", branch: "hero-trust" })
  })

  it("does nothing when the name doesn't change", () => {
    expect(
      checkBranchRename({ next: "Hero-Gradient", current: "hero-gradient" })
    ).toEqual({ kind: "unchanged" })
  })

  it("rejects an empty name", () => {
    expect(
      checkBranchRename({ next: " !! ", current: "hero-gradient" })
    ).toEqual({ kind: "invalid" })
  })

  it("rejects a branch that already exists on the remote", () => {
    expect(
      checkBranchRename({
        next: "main",
        current: "hero-gradient",
        remoteBranches: new Set(["main"]),
      })
    ).toEqual({ kind: "invalid" })
  })

  it("rejects a ref another local Workspace holds", () => {
    expect(
      checkBranchRename({
        next: "pricing-faq",
        current: "hero-gradient",
        otherLocalRefs: ["pricing-faq"],
      })
    ).toEqual({ kind: "invalid" })
  })
})
