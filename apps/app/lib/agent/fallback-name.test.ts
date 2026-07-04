import { describe, expect, it } from "vitest"

import { deriveFallbackName } from "@/lib/agent/fallback-name"

describe("deriveFallbackName", () => {
  it("drops stop-words and tidies the motivating example", () => {
    const { branch, label } = deriveFallbackName(
      "please fix the flaky login test"
    )
    // "please" and "the" are stop-words; the rest survive in order.
    expect(branch).toMatch(/^fix-flaky-login-test-[a-z0-9]{4}$/)
    expect(label).toBe("Fix Flaky Login Test")
    // No trace of the raw truncated-prompt slug that shipped before.
    expect(branch).not.toContain("please")
    expect(branch).not.toContain("the-flaky")
  })

  it("is deterministic — same prompt yields the same name", () => {
    const prompt = "add a dark mode toggle"
    expect(deriveFallbackName(prompt)).toEqual(deriveFallbackName(prompt))
  })

  it("gives different prompts different ids even when keywords collide", () => {
    const a = deriveFallbackName("fix the login test")
    const b = deriveFallbackName("please fix login test")
    // Same surviving keywords, but the id disambiguates them.
    expect(a.branch.replace(/-[a-z0-9]{4}$/, "")).toBe(
      b.branch.replace(/-[a-z0-9]{4}$/, "")
    )
    expect(a.branch).not.toBe(b.branch)
  })

  it("appends a short unique id and a readable prefix shape", () => {
    const { branch } = deriveFallbackName("refactor the payment flow")
    const segments = branch.split("-")
    const id = segments.at(-1)!
    expect(id).toMatch(/^[a-z0-9]{4}$/)
    // The keyword prefix precedes the id.
    expect(segments.slice(0, -1)).toEqual(["refactor", "payment", "flow"])
  })

  it("caps the branch keyword segment length without splitting a word", () => {
    const { branch } = deriveFallbackName(
      "implement comprehensive authentication authorization middleware everywhere"
    )
    const slug = branch.replace(/-[a-z0-9]{4}$/, "")
    expect(slug.length).toBeLessThanOrEqual(30)
    // Whole words only — no dangling partial word before the id.
    expect(slug).not.toMatch(/-$/)
    expect(branch.startsWith("implement-")).toBe(true)
  })

  it("caps the number of keywords carried into the label", () => {
    const { label } = deriveFallbackName(
      "build export import migrate archive rollback pipeline"
    )
    expect(label.split(" ").length).toBeLessThanOrEqual(4)
    expect(label).toBe("Build Export Import Migrate")
  })

  it("falls back to a prefix + id when only stop-words remain", () => {
    const { branch, label } = deriveFallbackName("please can you do the")
    expect(branch).toMatch(/^task-[a-z0-9]{4}$/)
    expect(label).toBe("Untitled Task")
  })

  it("handles empty and whitespace-only prompts", () => {
    for (const prompt of ["", "   ", "\n\t"]) {
      const { branch, label } = deriveFallbackName(prompt)
      expect(branch).toMatch(/^task-[a-z0-9]{4}$/)
      expect(label).toBe("Untitled Task")
    }
  })

  it("strips punctuation and collapses separators", () => {
    const { branch, label } = deriveFallbackName("Fix: the (login) bug!!!")
    expect(branch).toMatch(/^fix-login-bug-[a-z0-9]{4}$/)
    expect(label).toBe("Fix Login Bug")
  })

  it("produces a branch within the callers' 3..50 length bounds", () => {
    const prompts = [
      "go",
      "please fix the flaky login test",
      "implement comprehensive authentication authorization middleware everywhere",
      "",
    ]
    for (const prompt of prompts) {
      const { branch } = deriveFallbackName(prompt)
      expect(branch.length).toBeGreaterThanOrEqual(3)
      expect(branch.length).toBeLessThanOrEqual(50)
    }
  })
})
