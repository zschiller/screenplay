import { describe, expect, it } from "vitest"

import {
  ELEMENT_MARKER_TOKEN,
  MENTION_MARKER_TOKEN,
  PLAN_MODE_MARKER,
  REFERENCED_DOCS_FOOTER_TOKEN,
  SKILL_MARKER_TOKEN,
  TARGETED_ELEMENTS_FOOTER_TOKEN,
  buildReferencedDocsFooter,
  buildTargetedElementsFooter,
  deriveElementLabel,
  elementMarkersToPills,
  parseUserMessage,
  prependTurnMarkers,
  serializeElement,
  serializeMention,
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
      hadTargetedElements: false,
    })
  })

  it("round-trips plan present vs absent", () => {
    expect(
      parseUserMessage(prependTurnMarkers("a", { planMode: true })).planMode
    ).toBe(true)
    expect(parseUserMessage(prependTurnMarkers("a", {})).planMode).toBe(false)
  })

  it("round-trips branch present vs absent", () => {
    expect(
      parseUserMessage(prependTurnMarkers("a", { branch: "dev" })).branch
    ).toBe("dev")
    expect(parseUserMessage(prependTurnMarkers("a", {})).branch).toBeUndefined()
  })

  it("is a no-op on an already-clean string", () => {
    const parsed = parseUserMessage("just a normal message")

    expect(parsed).toEqual({
      planMode: false,
      branch: undefined,
      body: "just a normal message",
      hadReferencedDocs: false,
      hadTargetedElements: false,
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
    expect(
      skillMarkersToPills("run [skill: tdd] then [skill: diagnose] now")
    ).toBe("run [/tdd](skill:tdd) then [/diagnose](skill:diagnose) now")
  })

  it("is a no-op on a body with no skill markers", () => {
    expect(skillMarkersToPills("just a normal message")).toBe(
      "just a normal message"
    )
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

describe("buildReferencedDocsFooter", () => {
  it("returns an empty string when there are no docs", () => {
    expect(buildReferencedDocsFooter([])).toBe("")
  })

  it("opens with the canonical footer token and lists each doc by id", () => {
    const footer = buildReferencedDocsFooter([
      { id: "doc-1", title: "Spec" },
      { id: "doc-2", title: "Plan" },
    ])

    expect(footer).toContain(REFERENCED_DOCS_FOOTER_TOKEN)
    expect(footer).toContain("- markdown-layer doc-1: Spec")
    expect(footer).toContain("- markdown-layer doc-2: Plan")
  })

  it("falls back to Untitled when a doc has no title", () => {
    expect(buildReferencedDocsFooter([{ id: "doc-9" }])).toContain(
      "- markdown-layer doc-9: Untitled"
    )
  })

  it("round-trips: build → parse strips the footer and recovers the body exactly", () => {
    const body = "please review these docs"
    const wire =
      body + buildReferencedDocsFooter([{ id: "doc-1", title: "Spec" }])

    const parsed = parseUserMessage(wire)

    expect(parsed.body).toBe(body)
    expect(parsed.hadReferencedDocs).toBe(true)
  })

  it("reports hadReferencedDocs false when no footer was appended", () => {
    const wire = "just a message" + buildReferencedDocsFooter([])

    expect(parseUserMessage(wire).hadReferencedDocs).toBe(false)
  })

  it("strips the footer even alongside server turn prefixes", () => {
    const wire = prependTurnMarkers(
      "ship it" + buildReferencedDocsFooter([{ id: "doc-1", title: "Spec" }]),
      { planMode: true, branch: "feat/x" }
    )

    const parsed = parseUserMessage(wire)

    expect(parsed.planMode).toBe(true)
    expect(parsed.branch).toBe("feat/x")
    expect(parsed.body).toBe("ship it")
    expect(parsed.hadReferencedDocs).toBe(true)
  })
})

describe("serializeMention", () => {
  it("renders the inline mention marker as a markdown link", () => {
    expect(serializeMention("Spec", "doc-7")).toBe("[@Spec](mention:doc-7)")
  })

  it("matches the exported token's shape", () => {
    expect(serializeMention("<title>", "<id>")).toBe(MENTION_MARKER_TOKEN)
  })

  it("leaves the mention token inline in the parsed body for the renderer", () => {
    const wire = serializeMention("Design Notes", "doc-42")

    // Mentions ride the markdown-link form straight through — no prefix to
    // strip, no separate pill transform — so the renderer recovers the pill
    // from `body` directly.
    expect(parseUserMessage(wire).body).toBe("[@Design Notes](mention:doc-42)")
  })

  it("round-trips id and label exactly through parseUserMessage", () => {
    const wire = serializeMention("Quarterly Plan", "layer-abc123")

    const { body } = parseUserMessage(wire)
    const match = body.match(/^\[@(.*)\]\(mention:(.*)\)$/)

    expect(match?.[1]).toBe("Quarterly Plan")
    expect(match?.[2]).toBe("layer-abc123")
  })

  it("survives server turn prefixes, leaving the mention token in the body", () => {
    const wire = prependTurnMarkers(serializeMention("Spec", "doc-7"), {
      planMode: true,
      branch: "feat/x",
    })

    const parsed = parseUserMessage(wire)

    expect(parsed.planMode).toBe(true)
    expect(parsed.branch).toBe("feat/x")
    expect(parsed.body).toBe("[@Spec](mention:doc-7)")
  })
})

describe("deriveElementLabel", () => {
  it("is the bare tag name when the element has no id", () => {
    expect(deriveElementLabel("button")).toBe("button")
  })

  it("appends #id when the element has an id", () => {
    expect(deriveElementLabel("button", "submit")).toBe("button#submit")
  })

  it("treats an empty id like an absent one", () => {
    expect(deriveElementLabel("button", "")).toBe("button")
  })

  it("never emits class names — only the tag and optional id are inputs", () => {
    // The picker supplies tagName/id explicitly; classes are not an input, so
    // there is no path by which a class name (e.g. a Tailwind `.px-4`) can
    // reach the label.
    expect(deriveElementLabel("div", "hero")).toBe("div#hero")
    expect(deriveElementLabel("div")).toBe("div")
  })
})

describe("serializeElement", () => {
  it("renders the inline element marker as a markdown link", () => {
    expect(serializeElement("button#submit", "el-1")).toBe(
      "[element: button#submit](element:el-1)"
    )
  })

  it("renders the bare-tag label form", () => {
    expect(serializeElement("button", "el-1")).toBe(
      "[element: button](element:el-1)"
    )
  })

  it("matches the exported token's shape", () => {
    expect(serializeElement("<label>", "<ref>")).toBe(ELEMENT_MARKER_TOKEN)
  })
})

describe("elementMarkersToPills", () => {
  it("rewrites an inline element marker to its token link, dropping the prefix", () => {
    expect(elementMarkersToPills("[element: button](element:el-1)")).toBe(
      "[button](element:el-1)"
    )
  })

  it("preserves an id-bearing label", () => {
    expect(
      elementMarkersToPills("[element: button#submit](element:el-9)")
    ).toBe("[button#submit](element:el-9)")
  })

  it("tolerates a missing space after the colon", () => {
    expect(elementMarkersToPills("[element:input](element:el-2)")).toBe(
      "[input](element:el-2)"
    )
  })

  it("rewrites every marker in a body, leaving other text intact", () => {
    expect(
      elementMarkersToPills(
        "make [element: button](element:el-1) match [element: input](element:el-2)"
      )
    ).toBe("make [button](element:el-1) match [input](element:el-2)")
  })

  it("is a no-op on a body with no element markers", () => {
    expect(elementMarkersToPills("just a normal message")).toBe(
      "just a normal message"
    )
  })

  it("round-trips serializeElement through parseUserMessage back to the token", () => {
    const wire = serializeElement("button#submit", "el-1")

    const pill = elementMarkersToPills(parseUserMessage(wire).body)

    expect(pill).toBe("[button#submit](element:el-1)")
  })

  it("recovers the token even alongside server turn prefixes", () => {
    const wire = prependTurnMarkers(serializeElement("button", "el-1"), {
      planMode: true,
      branch: "feat/x",
    })

    const parsed = parseUserMessage(wire)

    expect(parsed.planMode).toBe(true)
    expect(parsed.branch).toBe("feat/x")
    expect(elementMarkersToPills(parsed.body)).toBe("[button](element:el-1)")
  })
})

describe("buildTargetedElementsFooter", () => {
  it("returns an empty string when there are no elements", () => {
    expect(buildTargetedElementsFooter([])).toBe("")
  })

  it("opens with the canonical footer token and lists a single element with route, selector, and frame", () => {
    const footer = buildTargetedElementsFooter([
      {
        ref: "el-1",
        route: "/dashboard",
        selector: "main > button.primary",
        frameLabel: "Home preview",
      },
    ])

    expect(footer).toContain(TARGETED_ELEMENTS_FOOTER_TOKEN)
    expect(footer).toContain(
      "- el-1: /dashboard — main > button.primary (frame: Home preview)"
    )
  })

  it("lists each element on its own line for many elements", () => {
    const footer = buildTargetedElementsFooter([
      {
        ref: "el-1",
        route: "/",
        selector: "button#submit",
        frameLabel: "Frame A",
      },
      {
        ref: "el-2",
        route: "/settings",
        selector: "form > input",
        frameLabel: "Frame B",
      },
    ])

    expect(footer).toContain("- el-1: / — button#submit (frame: Frame A)")
    expect(footer).toContain(
      "- el-2: /settings — form > input (frame: Frame B)"
    )
  })

  it("round-trips: build → parse strips the footer and recovers the body exactly", () => {
    const body = "make these match"
    const wire =
      body +
      buildTargetedElementsFooter([
        {
          ref: "el-1",
          route: "/",
          selector: "button",
          frameLabel: "Frame A",
        },
      ])

    const parsed = parseUserMessage(wire)

    expect(parsed.body).toBe(body)
    expect(parsed.hadTargetedElements).toBe(true)
  })

  it("reports hadTargetedElements false when no footer was appended", () => {
    const wire = "just a message" + buildTargetedElementsFooter([])

    expect(parseUserMessage(wire).hadTargetedElements).toBe(false)
  })

  it("strips the footer even alongside server turn prefixes", () => {
    const wire = prependTurnMarkers(
      "ship it" +
        buildTargetedElementsFooter([
          {
            ref: "el-1",
            route: "/",
            selector: "button",
            frameLabel: "Frame A",
          },
        ]),
      { planMode: true, branch: "feat/x" }
    )

    const parsed = parseUserMessage(wire)

    expect(parsed.planMode).toBe(true)
    expect(parsed.branch).toBe("feat/x")
    expect(parsed.body).toBe("ship it")
    expect(parsed.hadTargetedElements).toBe(true)
  })

  it("coexists with the referenced-docs footer: both flags set, body recovered exactly (docs first)", () => {
    const body = "review the spec and fix this button"
    const wire =
      body +
      buildReferencedDocsFooter([{ id: "doc-1", title: "Spec" }]) +
      buildTargetedElementsFooter([
        { ref: "el-1", route: "/", selector: "button", frameLabel: "Frame A" },
      ])

    const parsed = parseUserMessage(wire)

    expect(parsed.body).toBe(body)
    expect(parsed.hadReferencedDocs).toBe(true)
    expect(parsed.hadTargetedElements).toBe(true)
  })

  it("coexists with the referenced-docs footer regardless of order (elements first)", () => {
    const body = "fix this button per the spec"
    const wire =
      body +
      buildTargetedElementsFooter([
        { ref: "el-1", route: "/", selector: "button", frameLabel: "Frame A" },
      ]) +
      buildReferencedDocsFooter([{ id: "doc-1", title: "Spec" }])

    const parsed = parseUserMessage(wire)

    expect(parsed.body).toBe(body)
    expect(parsed.hadReferencedDocs).toBe(true)
    expect(parsed.hadTargetedElements).toBe(true)
  })

  it("leaves inline element markers in the body while stripping only the footer", () => {
    const body = serializeElement("button", "el-1")
    const wire =
      body +
      buildTargetedElementsFooter([
        { ref: "el-1", route: "/", selector: "button", frameLabel: "Frame A" },
      ])

    const parsed = parseUserMessage(wire)

    expect(parsed.body).toBe("[element: button](element:el-1)")
    expect(parsed.hadTargetedElements).toBe(true)
  })
})
