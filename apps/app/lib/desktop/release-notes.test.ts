import { describe, expect, it } from "vitest"

import {
  changesTheApp,
  fallbackReleaseNotes,
  mergedPrsFromSubjects,
  releaseNotesPrompt,
  withCompareLink,
} from "./release-notes"

describe("mergedPrsFromSubjects", () => {
  it("reads the PR number and title from squash-merge subjects", () => {
    expect(
      mergedPrsFromSubjects([
        "Run and Stop for the dev server (#1342) (#1348)",
        "Steer Codex chats mid-turn (#1304)",
      ])
    ).toEqual([
      { number: 1348, title: "Run and Stop for the dev server" },
      { number: 1304, title: "Steer Codex chats mid-turn" },
    ])
  })

  it("drops direct commits and release bookkeeping", () => {
    expect(
      mergedPrsFromSubjects([
        "Release Screenplay Desktop 0.1.5",
        "Release @screenplay.space/state 0.2.0 (#1082)",
        "docs: refresh screenshots (#1129)",
        "Fix a typo on main",
      ])
    ).toEqual([])
  })
})

describe("changesTheApp", () => {
  it("counts app, desktop shell and shared package sources", () => {
    expect(changesTheApp(["apps/app/components/chat/composer.tsx"])).toBe(true)
    expect(changesTheApp(["apps/desktop/src-tauri/src/main.rs"])).toBe(true)
    expect(changesTheApp(["packages/ui/src/components/button.tsx"])).toBe(true)
  })

  it("ignores the homepage, docs, CI, tests and screenshots", () => {
    expect(
      changesTheApp([
        "apps/homepage/components/marketing/hero.tsx",
        "apps/docs/content/guides/quickstart.mdx",
        ".github/workflows/ci.yml",
        "apps/app/test/env-docs.test.ts",
        "apps/app/lib/desktop/release-notes.test.ts",
        "apps/app/screenshots/screens/core.ts",
        "apps/app/CONTEXT.md",
      ])
    ).toBe(false)
  })
})

describe("releaseNotesPrompt", () => {
  it("carries the version and every PR's title and description", () => {
    const prompt = releaseNotesPrompt({
      version: "0.1.6",
      prs: [
        {
          number: 1348,
          title: "Run and Stop for the dev server",
          body: "Before: no way to stop it.",
        },
        { number: 1304, title: "Steer Codex chats mid-turn", body: "" },
      ],
    })
    expect(prompt).toContain("Screenplay Desktop 0.1.6")
    expect(prompt).toContain(
      "## Run and Stop for the dev server (#1348)\n\nBefore: no way to stop it."
    )
    expect(prompt).toContain(
      "## Steer Codex chats mid-turn (#1304)\n\n(no description)"
    )
  })

  it("trims long descriptions", () => {
    const prompt = releaseNotesPrompt({
      version: "0.1.6",
      prs: [{ number: 1, title: "Long", body: "x".repeat(5000) }],
    })
    expect(prompt).not.toContain("x".repeat(1501))
  })
})

describe("fallbackReleaseNotes", () => {
  it("lists PR titles without numbers or authors", () => {
    expect(
      fallbackReleaseNotes([
        { number: 1304, title: "Steer Codex chats mid-turn" },
      ])
    ).toBe("### Changes\n\n- Steer Codex chats mid-turn")
  })

  it("says so when nothing in the app changed", () => {
    expect(fallbackReleaseNotes([])).toBe(
      "Behind-the-scenes fixes and maintenance."
    )
  })
})

describe("withCompareLink", () => {
  it("ends the notes with a link to every change since the last release", () => {
    expect(
      withCompareLink("Notes.\n", {
        repo: "zschiller/screenplay",
        previousTag: "desktop-v0.1.5",
        tag: "desktop-v0.1.6",
      })
    ).toBe(
      "Notes.\n\n[Every change since 0.1.5](https://github.com/zschiller/screenplay/compare/desktop-v0.1.5...desktop-v0.1.6)\n"
    )
  })
})
