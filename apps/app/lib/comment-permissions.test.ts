import { describe, expect, it } from "vitest"

import {
  canDeleteComment,
  canDeleteThread,
  canEditComment,
} from "./comment-permissions"

describe("comment permissions", () => {
  it("lets only a comment's author edit or delete it", () => {
    const comment = { authorId: "a" }
    expect(canEditComment(comment, "a")).toBe(true)
    expect(canDeleteComment(comment, "a")).toBe(true)
    expect(canEditComment(comment, "b")).toBe(false)
    expect(canDeleteComment(comment, "b")).toBe(false)
    expect(canEditComment(comment, null)).toBe(false)
  })

  it("lets the sender delete the agent's reply but not edit it", () => {
    const reply = { authorId: "a", fromAgent: true }
    expect(canDeleteComment(reply, "a")).toBe(true)
    expect(canEditComment(reply, "a")).toBe(false)
  })

  it("lets only the thread's starter delete the thread", () => {
    const thread = { createdBy: "a" }
    expect(canDeleteThread(thread, "a")).toBe(true)
    expect(canDeleteThread(thread, "b")).toBe(false)
    expect(canDeleteThread(thread, null)).toBe(false)
  })
})
