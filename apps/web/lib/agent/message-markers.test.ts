import { describe, expect, it } from "vitest"

import {
  PLAN_MODE_MARKER,
  SKILL_MARKER_TOKEN,
  parseUserMessage,
  prependTurnMarkers,
  serializeSkill,
  skillMarkersToPills,
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

describe("serializeSkill", () => {
  it("renders the inline skill marker", () => {
    expect(serializeSkill("tdd")).toBe("[skill: tdd]")
  })

  it("matches the exported token's shape", () => {
    expect(serializeSkill("<name>")).toBe(SKILL_MARKER_TOKEN)
  })
})

describe("skillMarkersToPills", () => {
  it("rewrites an inline skill marker to its pill link", () => {
    expect(skillMarkersToPills("[skill: tdd]")).toBe("[/tdd](skill:tdd)")
  })

  it("tolerates a missing space after the colon", () => {
    expect(skillMarkersToPills("[skill:tdd]")).toBe("[/tdd](skill:tdd)")
  })

  it("rewrites every marker in a body, leaving other text intact", () => {
    expect(skillMarkersToPills("run [skill: tdd] then [skill: diagnose] now")).toBe(
      "run [/tdd](skill:tdd) then [/diagnose](skill:diagnose) now",
    )
  })

  it("is a no-op on a body with no skill markers", () => {
    expect(skillMarkersToPills("just a normal message")).toBe("just a normal message")
  })

  it("round-trips serializeSkill through parseUserMessage back to the pill", () => {
    const wire = serializeSkill("tdd")

    const pill = skillMarkersToPills(parseUserMessage(wire).body)

    expect(pill).toBe("[/tdd](skill:tdd)")
  })

  it("recovers the pill even alongside server turn prefixes", () => {
    const wire = prependTurnMarkers(serializeSkill("tdd"), {
      planMode: true,
      branch: "feat/x",
    })

    const parsed = parseUserMessage(wire)

    expect(parsed.planMode).toBe(true)
    expect(parsed.branch).toBe("feat/x")
    expect(skillMarkersToPills(parsed.body)).toBe("[/tdd](skill:tdd)")
  })
})
