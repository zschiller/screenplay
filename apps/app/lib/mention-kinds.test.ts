import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  MENTION_KIND_REGISTRY,
  MENTION_KINDS,
  type MentionTargets,
  mentionCandidates,
  mentionKindOf,
  mentionKindOfMarkdown,
  mentionMarkdownNames,
  mentionTargetLabel,
} from "@/lib/mention-kinds"

/**
 * The mention kind registry: every Document mention kind's heading, icon,
 * mask, markdown name, candidates and live name come from one entry.
 */

const sources = {
  documents: [
    { id: "d1", title: "Pricing notes" },
    { id: "d2", title: "" },
  ],
  branches: [{ id: "b1", title: "Checkout polish" }],
  chatSessions: [
    { id: "s1", label: "Empty cart state", target: "sketch" as const },
    { id: "s2", label: "Coordinator", target: "room" as const },
  ],
  mockups: [{ id: "m1", title: "Option A · Illustrated" }],
}

describe("MENTION_KIND_REGISTRY", () => {
  it("lists the kinds in the `@` list’s group order", () => {
    expect(MENTION_KINDS).toEqual(["markdown-layer", "chat", "mockup-layer"])
    expect(MENTION_KINDS.map((k) => MENTION_KIND_REGISTRY[k].heading)).toEqual([
      "Documents",
      "Chats",
      "Mockups",
    ])
  })

  it("has a CSS rule for every kind’s icon mask", () => {
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8")
    for (const kind of MENTION_KINDS) {
      const { mask } = MENTION_KIND_REGISTRY[kind]
      expect(css).toContain(`.inline-ref[data-inline-ref-mask="${mask}"]`)
    }
  })

  it("gives every kind its own markdown name", () => {
    const names = MENTION_KINDS.map(
      (k) => MENTION_KIND_REGISTRY[k].markdownName
    )
    expect(new Set(names).size).toBe(names.length)
    for (const kind of MENTION_KINDS) {
      expect(
        mentionKindOfMarkdown(MENTION_KIND_REGISTRY[kind].markdownName)
      ).toBe(kind)
    }
    expect(mentionMarkdownNames()).toBe("`document`, `chat` or `mockup`")
  })
})

describe("mentionKindOf", () => {
  it("keeps a registered kind and reads anything else as a document", () => {
    for (const kind of MENTION_KINDS) expect(mentionKindOf(kind)).toBe(kind)
    expect(mentionKindOf(undefined)).toBe("markdown-layer")
    expect(mentionKindOf("iframe-layer")).toBe("markdown-layer")
    expect(mentionKindOf("toString")).toBe("markdown-layer")
  })
})

describe("mentionCandidates", () => {
  it("gives every kind in registry order, leaving out the current Document", () => {
    expect(mentionCandidates(sources, { excludeId: "d1" })).toEqual([
      { kind: "markdown-layer", id: "d2", label: "Untitled" },
      { kind: "chat", id: "b1", label: "Checkout polish" },
      { kind: "chat", id: "s1", label: "Empty cart state" },
      { kind: "mockup-layer", id: "m1", label: "Option A · Illustrated" },
    ])
  })

  it("offers only the lists it’s given, as the composer’s documents", () => {
    expect(
      mentionCandidates({ documents: sources.documents }).map((c) => c.kind)
    ).toEqual(["markdown-layer", "markdown-layer"])
  })
})

describe("mentionTargetLabel", () => {
  const targets = (names: {
    doc?: string
    workspace?: string
    chat?: string
    mockup?: string
  }): MentionTargets => ({
    document: (id) =>
      id === "d1" && names.doc !== undefined ? { title: names.doc } : undefined,
    workspace: (id) =>
      id === "b1" && names.workspace !== undefined
        ? { title: names.workspace }
        : undefined,
    chat: (id) =>
      id === "s1" && names.chat !== undefined
        ? { label: names.chat }
        : undefined,
    mockup: (id) =>
      id === "m1" && names.mockup !== undefined
        ? { title: names.mockup }
        : undefined,
  })

  it.each([
    ["markdown-layer", "d1", { doc: "Field notes" }, "Field notes"],
    ["chat", "b1", { workspace: "Fix sign in" }, "Fix sign in"],
    ["chat", "b1", { workspace: "" }, "New chat"],
    ["chat", "s1", { chat: "Sketch the cart" }, "Sketch the cart"],
    ["mockup-layer", "m1", { mockup: "Hero v2" }, "Hero v2"],
  ] as const)(
    "names a %s mention (%s) by its current name",
    (kind, id, names, label) => {
      expect(mentionTargetLabel(kind, id, targets(names))).toBe(label)
    }
  )

  it("is undefined when what it points at is gone or unnamed", () => {
    for (const kind of MENTION_KINDS) {
      expect(mentionTargetLabel(kind, "gone", targets({}))).toBeUndefined()
    }
    expect(
      mentionTargetLabel("markdown-layer", "d1", targets({ doc: "" }))
    ).toBeUndefined()
  })
})
