import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"
import middleware from "@/proxy"

function visit(path: string) {
  return middleware(new NextRequest(new URL(path, "https://example.com")))
}

describe("proxy", () => {
  it("serves the favicon signed out", () => {
    // The sign-in page and Vercel's dashboard ask for it without a session.
    expect(visit("/icon").headers.get("location")).toBeNull()
  })

  it("sends signed-out visitors elsewhere to sign in", () => {
    expect(visit("/some-room").headers.get("location")).toBe(
      "https://example.com/sign-in"
    )
  })
})
