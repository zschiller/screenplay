import { describe, expect, it } from "vitest"

import { sanitizeBranchName } from "@/lib/branch-rename"

describe("sanitizeBranchName", () => {
  it("lowercases and hyphenates a typed name", () => {
    expect(sanitizeBranchName("  Hero Trust Line! ")).toBe("hero-trust-line")
    expect(sanitizeBranchName("feat/Pricing_FAQ")).toBe("feat/pricing_faq")
  })
})
