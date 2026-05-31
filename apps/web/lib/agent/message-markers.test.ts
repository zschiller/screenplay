import { describe, expect, it } from "vitest"

import {
  PLAN_MODE_MARKER,
  parseUserMessage,
  prependTurnMarkers,
} from "@/lib/agent/message-markers"

describe("prependTurnMarkers", () => {
  it("renders plan before branch", () => {
    const out = prependTurnMarkers("do the thing", {
      planMode: true,
      branch: "feat/x",
    })

    expect(out).toBe("[plan mode: enabled] [branch: feat/x] do the thing")
  })

  it("emits only the plan prefix when branch is absent", () => {
    const out = prependTurnMarkers("hello", { planMode: true })

    expect(out).toBe("[plan mode: enabled] hello")
  })

  it("emits only the branch prefix when plan is absent", () => {
    const out = prependTurnMarkers("hello", { branch: "main" })

    expect(out).toBe("[branch: main] hello")
  })

  it("returns the body unchanged when neither marker is present", () => {
    expect(prependTurnMarkers("hello", {})).toBe("hello")
  })

  it("interpolates the exported plan-mode token", () => {
    const out = prependTurnMarkers("x", { planMode: true })

    expect(out.startsWith(`${PLAN_MODE_MARKER} `)).toBe(true)
  })
})

describe("parseUserMessage", () => {
  it("round-trips plan and branch together", () => {
    const wire = prependTurnMarkers("ship it", {
      planMode: true,
      branch: "feat/x",
    })

    const parsed = parseUserMessage(wire)

    expect(parsed).toEqual({
      planMode: true,
      branch: "feat/x",
      body: "ship it",
      hadReferencedDocs: false,
    })
  })

  it("round-trips plan present vs absent", () => {
    expect(parseUserMessage(prependTurnMarkers("a", { planMode: true })).planMode).toBe(true)
    expect(parseUserMessage(prependTurnMarkers("a", {})).planMode).toBe(false)
  })

  it("round-trips branch present vs absent", () => {
    expect(parseUserMessage(prependTurnMarkers("a", { branch: "dev" })).branch).toBe("dev")
    expect(parseUserMessage(prependTurnMarkers("a", {})).branch).toBeUndefined()
  })

  it("is a no-op on an already-clean string", () => {
    const parsed = parseUserMessage("just a normal message")

    expect(parsed).toEqual({
      planMode: false,
      branch: undefined,
      body: "just a normal message",
      hadReferencedDocs: false,
    })
  })

  it("leaves a `]`-containing body intact when a branch prefix is present", () => {
    const wire = prependTurnMarkers("update array[5] = x", { branch: "fix" })

    const parsed = parseUserMessage(wire)

    expect(parsed.branch).toBe("fix")
    expect(parsed.body).toBe("update array[5] = x")
  })

  it("parses a branch ref containing spaces back exactly", () => {
    const wire = prependTurnMarkers("body", { branch: "feature foo" })

    expect(parseUserMessage(wire).branch).toBe("feature foo")
  })

  it("parses a branch ref containing brackets back exactly", () => {
    const wire = prependTurnMarkers("body", { branch: "release-[2024]" })

    expect(parseUserMessage(wire).branch).toBe("release-[2024]")
  })
})
