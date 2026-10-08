import { describe, expect, it } from "vitest"

import {
  missingPrerequisites,
  type SetupFacts,
  type SetupNeeds,
} from "./setup-check"

const ready: SetupFacts = {
  nodeVersion: "22.22.0",
  onPath: () => true,
  ptyBuilt: true,
  chrome: "/usr/bin/chrome",
}

const builtIn: SetupNeeds = {
  codingClis: null,
  builtInClis: ["claude", "codex", "opencode"],
  githubCommand: "gh",
}

const without =
  (...commands: string[]) =>
  (command: string) =>
    !commands.includes(command)

describe("missingPrerequisites", () => {
  it("passes a ready box", () => {
    expect(missingPrerequisites(ready, builtIn)).toEqual([])
  })

  it("names each missing prerequisite on its own line", () => {
    expect(
      missingPrerequisites(
        {
          nodeVersion: "20.11.1",
          onPath: without(
            "git",
            "make",
            "g++",
            "c++",
            "claude",
            "codex",
            "opencode",
            "gh"
          ),
          ptyBuilt: false,
          chrome: null,
        },
        builtIn
      )
    ).toEqual([
      "Node 22 or later (this is 20.11.1)",
      "git, for every chat’s code",
      "A C++ toolchain for the terminal (make, g++), then pnpm install again",
      "Chrome for thumbnails: set CHROMIUM_PATH, or run pnpm --filter app exec puppeteer browsers install chrome",
      "A coding CLI: one of claude, codex, opencode, or name yours in CODING_CLIS",
      "The GitHub CLI, gh",
    ])
  })

  it("asks for a rebuild when the toolchain is there but the terminal isn't built", () => {
    expect(
      missingPrerequisites({ ...ready, ptyBuilt: false }, builtIn)
    ).toEqual(["The terminal’s native build: run pnpm rebuild node-pty"])
  })

  it("needs any one built-in coding CLI", () => {
    expect(
      missingPrerequisites(
        { ...ready, onPath: without("claude", "opencode") },
        builtIn
      )
    ).toEqual([])
  })

  it("needs every coding CLI CODING_CLIS lists, and its GitHub command", () => {
    expect(
      missingPrerequisites(
        { ...ready, onPath: without("corp-code", "corp-gh") },
        {
          ...builtIn,
          codingClis: ["claude", "corp-code"],
          githubCommand: "corp-gh",
        }
      )
    ).toEqual([
      "The coding CLI corp-code, which CODING_CLIS lists",
      "The GitHub command corp-gh, which GitHub access runs",
    ])
  })

  it("needs no GitHub command when GitHub access uses none", () => {
    expect(
      missingPrerequisites(
        { ...ready, onPath: without("gh") },
        { ...builtIn, githubCommand: null }
      )
    ).toEqual([])
  })
})
