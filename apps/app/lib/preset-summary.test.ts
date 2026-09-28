import { describe, expect, it } from "vitest"
import { duplicateName, presetSummary } from "@/lib/preset-summary"
import type { RepoConfig } from "@/lib/repo-configs.types"

function config(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
    id: "cfg",
    name: "storefront",
    repoFullName: "acme/storefront",
    repoOwner: "acme",
    repoName: "storefront",
    defaultBranch: "main",
    cloneUrl: "https://github.com/acme/storefront.git",
    private: false,
    setupScript: "pnpm install",
    devScript: "pnpm dev",
    devServerPort: 3000,
    envVars: "",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe("presetSummary", () => {
  it("lists the scripts, port and env var count on the web build", () => {
    expect(
      presetSummary(config({ envVars: "A=1\n# note\nB=2\n" }), false)
    ).toEqual({
      commands: ["pnpm install", "pnpm dev"],
      facts: ["port 3000", "2 env vars"],
    })
  })

  it("says var for one env var and skips an empty env", () => {
    expect(presetSummary(config({ envVars: "A=1" }), false).facts).toEqual([
      "port 3000",
      "1 env var",
    ])
    expect(presetSummary(config(), false).facts).toEqual(["port 3000"])
  })

  it("shows copied files instead of port and env on desktop", () => {
    expect(
      presetSummary(
        config({ envVars: "A=1", copyPatterns: ".env*\n.npmrc" }),
        true
      ).facts
    ).toEqual(["copies .env*, .npmrc"])
  })

  it("drops blank scripts", () => {
    expect(
      presetSummary(config({ setupScript: " ", devScript: "" }), true).commands
    ).toEqual([])
  })
})

describe("duplicateName", () => {
  it("appends copy, then a number past names already taken", () => {
    const original = config()
    expect(duplicateName(original, [original])).toBe("storefront copy")
    expect(
      duplicateName(original, [
        original,
        config({ id: "b", name: "storefront copy" }),
      ])
    ).toBe("storefront copy 2")
  })

  it("names a default preset's copy and ignores other projects", () => {
    const original = config({ name: "" })
    expect(
      duplicateName(original, [
        original,
        config({ id: "b", name: "default copy", repoFullName: "acme/web" }),
      ])
    ).toBe("default copy")
  })
})
