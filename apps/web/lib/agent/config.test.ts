import { describe, expect, it } from "vitest"

import { buildAgentSystemPrompt } from "@/lib/agent/config"
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
