import { describe, expect, it } from "vitest"

import { buildAgentSystemPrompt } from "@/lib/agent/config"

const EMPTY_DIRECTORY = { documents: [] }

describe("buildAgentSystemPrompt — skills block", () => {
  it("lists the bundled App Skills by name and description", () => {
    const prompt = buildAgentSystemPrompt(undefined, EMPTY_DIRECTORY)

    expect(prompt).toContain("Skills available:")
    // The two bundled App Skills shipped in lib/skills/.
    expect(prompt).toMatch(/- \*\*knobs\*\*:/)
    expect(prompt).toMatch(/- \*\*state\*\*:/)
  })

  it("makes read_skill mandatory when the message carries a [skill: …] marker", () => {
    const prompt = buildAgentSystemPrompt(undefined, EMPTY_DIRECTORY)

    expect(prompt).toContain("[skill: <name>]")
    expect(prompt).toContain("MANDATORY")
    // The rule must tie the marker to a non-optional read_skill call before
    // any other action — that's what makes `/` invocation deterministic.
    expect(prompt).toMatch(/MUST call `read_skill`/)
  })

  it("appends repo system prompt after the skills block when provided", () => {
    const prompt = buildAgentSystemPrompt("Targets apps/web.", EMPTY_DIRECTORY)

    expect(prompt).toContain("Workspace context:")
    expect(prompt).toContain("Targets apps/web.")
    expect(prompt.indexOf("Skills available:")).toBeLessThan(
      prompt.indexOf("Workspace context:"),
    )
  })
})
