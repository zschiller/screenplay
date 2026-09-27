import { describe, expect, it } from "vitest"

import {
  buildAgentSystemPrompt,
  buildMarkdownLayerSystemPrompt,
} from "@/lib/agent/config"
import type { OriginTaggedSkill } from "@/lib/skills/merged"

const EMPTY_DIRECTORY = { documents: [] }

const APP_SKILLS: OriginTaggedSkill[] = [
  {
    name: "screenplay-add-knob",
    description: "Add interactive controls.",
    origin: "app",
  },
  {
    name: "screenplay-share-state",
    description: "Share state across artboards.",
    origin: "app",
  },
]

describe("buildAgentSystemPrompt — skills block", () => {
  it("lists every skill in the merged index by name and description", () => {
    const prompt = buildAgentSystemPrompt({
      layerDirectory: EMPTY_DIRECTORY,
      skills: APP_SKILLS,
    })

    expect(prompt).toContain("Skills available:")
    expect(prompt).toMatch(/- \*\*screenplay-add-knob\*\*:/)
    expect(prompt).toMatch(/- \*\*screenplay-share-state\*\*:/)
  })

  it("folds Repo Skills into the prompt alongside App Skills", () => {
    const prompt = buildAgentSystemPrompt({
      layerDirectory: EMPTY_DIRECTORY,
      skills: [
        ...APP_SKILLS,
        { name: "deploy", description: "Deploy this branch.", origin: "repo" },
      ],
    })

    expect(prompt).toMatch(/- \*\*deploy\*\*: Deploy this branch\./)
  })

  it("rolls a fresh prompt when the repo-skill index changes", () => {
    // The persisted system prompt is the cache key; embedding the merged Skill
    // metadata is what makes editing a Repo Skill on a branch roll a new prompt.
    const before = buildAgentSystemPrompt({
      layerDirectory: EMPTY_DIRECTORY,
      skills: APP_SKILLS,
    })
    const after = buildAgentSystemPrompt({
      layerDirectory: EMPTY_DIRECTORY,
      skills: [
        ...APP_SKILLS,
        { name: "deploy", description: "Deploy this branch.", origin: "repo" },
      ],
    })

    expect(after).not.toEqual(before)
  })

  it("omits the skills block entirely when no skills are available", () => {
    const prompt = buildAgentSystemPrompt({
      layerDirectory: EMPTY_DIRECTORY,
      skills: [],
    })

    expect(prompt).not.toContain("Skills available:")
  })

  it("makes read_skill mandatory when the message carries a [skill: …] marker", () => {
    const prompt = buildAgentSystemPrompt({
      layerDirectory: EMPTY_DIRECTORY,
      skills: APP_SKILLS,
    })

    expect(prompt).toContain("[skill: <name>]")
    expect(prompt).toContain("MANDATORY")
    // The rule must tie the marker to a non-optional read_skill call before
    // any other action — that's what makes `/` invocation deterministic.
    expect(prompt).toMatch(/MUST call `read_skill`/)
  })

  it("appends repo system prompt after the skills block when provided", () => {
    const prompt = buildAgentSystemPrompt({
      repoSystemPrompt: "Targets apps/web.",
      layerDirectory: EMPTY_DIRECTORY,
      skills: APP_SKILLS,
    })

    expect(prompt).toContain("Workspace context:")
    expect(prompt).toContain("Targets apps/web.")
    expect(prompt.indexOf("Skills available:")).toBeLessThan(
      prompt.indexOf("Workspace context:")
    )
  })
})

describe("buildMarkdownLayerSystemPrompt — formatting rules", () => {
  const prompt = () =>
    buildMarkdownLayerSystemPrompt({
      currentTitle: "Sprint notes",
      currentBody: "Standup is at 10.",
      layerDirectory: EMPTY_DIRECTORY,
      selfId: "doc-1",
    })

  // `replace_document_body` parses its content as CommonMark, so marks do
  // survive a save. The prompt used to claim the opposite and tell the model to
  // emit plain text, contradicting the tool's own description (#743).
  it("tells the model inline marks are preserved", () => {
    expect(prompt()).toContain("Inline marks are preserved")
    expect(prompt()).not.toMatch(/emit plain text/)
  })

  // The narrower truth behind that stale line: `append_to_document_body`
  // re-reads the body as plain text first, so it flattens marks already in the
  // document. The prompt states that limitation specifically, scoped to append.
  it("scopes the flattening caveat to the append tool", () => {
    const rule = prompt()
      .split("\n")
      .find((line) => line.includes("flattened"))

    expect(rule).toBeDefined()
    expect(rule).toContain("append_to_document_body")
    expect(rule).toContain("replace_document_body")
  })

  it("never mentions a sandbox, shell, or commands", () => {
    expect(prompt()).toMatch(/no sandbox, no shell, no git/)
    expect(prompt()).not.toMatch(/run_command/)
  })
})
