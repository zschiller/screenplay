import { describe, expect, it } from "vitest"
import { TMUX_SESSION_PREFIX, tmuxSessionName } from "@/lib/terminal/session"

describe("tmuxSessionName", () => {
  it("prefixes the tab id with the screenplay- namespace", () => {
    expect(tmuxSessionName("abc123")).toBe("screenplay-abc123")
  })

  it("uses the exported prefix so server and client agree", () => {
    const id = "V1StGXR8_Z5jdHi6B-myT"
    expect(tmuxSessionName(id)).toBe(`${TMUX_SESSION_PREFIX}${id}`)
  })

  it("passes a nanoid's URL-safe chars through unchanged (no tmux-illegal . or :)", () => {
    const id = "aB0_-9zZ"
    const name = tmuxSessionName(id)
    expect(name).not.toContain(".")
    expect(name).not.toContain(":")
    expect(name).toBe(`screenplay-${id}`)
  })
})
