import { describe, expect, it } from "vitest"
import { branchTitle, humanizeRef, sanitizeBranchTitle } from "./branch-title"

describe("branchTitle", () => {
  it("prefers the stored title", () => {
    expect(
      branchTitle({ title: "Mobile checkout", ref: "checkout-polish" })
    ).toBe("Mobile checkout")
  })

  it("falls back to a readable ref when untitled or blank", () => {
    expect(branchTitle({ ref: "fix-login-button" })).toBe("Fix login button")
    expect(branchTitle({ title: "  ", ref: "add_dark.mode" })).toBe(
      "Add dark mode"
    )
  })
})

describe("humanizeRef", () => {
  it("keeps only the last path segment", () => {
    expect(humanizeRef("claude/empty-cart-state")).toBe("Empty cart state")
  })

  it("returns the ref unchanged when nothing readable is left", () => {
    expect(humanizeRef("")).toBe("")
    expect(humanizeRef("--")).toBe("--")
  })
})

describe("sanitizeBranchTitle", () => {
  it("collapses whitespace and caps length", () => {
    expect(sanitizeBranchTitle("  Apple   Pay\n button ")).toBe(
      "Apple Pay button"
    )
    expect(sanitizeBranchTitle("x".repeat(100))).toHaveLength(80)
  })
})
