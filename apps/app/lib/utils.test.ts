import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { formatDistanceToNow } from "./utils"

const NOW = new Date(2026, 8, 27, 12, 0, 0).getTime()
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

describe("formatDistanceToNow", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it("is relative within a week", () => {
    expect(formatDistanceToNow(NOW - 10_000)).toBe("just now")
    expect(formatDistanceToNow(NOW - 13 * MINUTE)).toBe("13m ago")
    expect(formatDistanceToNow(NOW - 5 * 60 * MINUTE)).toBe("5h ago")
    expect(formatDistanceToNow(NOW - 6 * DAY)).toBe("6d ago")
  })

  it("is a short month and day after a week", () => {
    const date = new Date(2026, 7, 26)
    expect(formatDistanceToNow(date.getTime())).toBe(
      date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    )
  })

  it("adds the year only for another year", () => {
    const date = new Date(2025, 7, 26)
    expect(formatDistanceToNow(date.getTime())).toBe(
      date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    )
  })
})
