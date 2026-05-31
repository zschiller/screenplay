import { describe, expect, it } from "vitest"

import { parseFrontmatter } from "@/lib/skills/frontmatter"

describe("parseFrontmatter", () => {
  it("parses name + description and returns the body", () => {
    const raw = [
      "---",
      "name: deploy",
      "description: Deploy this branch.",
      "---",
      "",
      "# Heading",
      "Body text.",
    ].join("\n")

    const { metadata, body } = parseFrontmatter(raw, "deploy/SKILL.md")

    expect(metadata).toEqual({
      name: "deploy",
      description: "Deploy this branch.",
    })
    expect(body).toContain("# Heading")
    expect(body).toContain("Body text.")
  })

  it("strips surrounding double quotes from values", () => {
    const raw = [
      "---",
      'name: "deploy"',
      'description: "Deploy, carefully."',
      "---",
      "body",
    ].join("\n")

    const { metadata } = parseFrontmatter(raw, "x")

    expect(metadata.name).toBe("deploy")
    expect(metadata.description).toBe("Deploy, carefully.")
  })

  it("throws when the frontmatter block is missing", () => {
    expect(() => parseFrontmatter("# Just a doc\n", "x/SKILL.md")).toThrow(
      /missing a YAML frontmatter block/,
    )
  })

  it("throws when name is missing", () => {
    const raw = ["---", "description: No name here.", "---", "body"].join("\n")
    expect(() => parseFrontmatter(raw, "x")).toThrow(
      /must declare both "name" and "description"/,
    )
  })

  it("throws when description is missing", () => {
    const raw = ["---", "name: deploy", "---", "body"].join("\n")
    expect(() => parseFrontmatter(raw, "x")).toThrow(
      /must declare both "name" and "description"/,
    )
  })

  it("ignores unrelated frontmatter lines", () => {
    const raw = [
      "---",
      "name: deploy",
      "description: Deploy.",
      "# a comment line that isn't a field",
      "version: 2",
      "---",
      "body",
    ].join("\n")

    const { metadata } = parseFrontmatter(raw, "x")

    expect(metadata).toEqual({ name: "deploy", description: "Deploy." })
  })
})
