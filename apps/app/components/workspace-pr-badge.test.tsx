// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"

import { WorkspacePrBadge, workspacePr } from "./workspace-mention"

afterEach(cleanup)

const badge = (props: Parameters<typeof WorkspacePrBadge>[0]) =>
  render(<WorkspacePrBadge {...props} />).container.querySelector(
    "[data-slot=workspace-pr]"
  )!

describe("WorkspacePrBadge", () => {
  it("gives each PR state its own glyph and colour", () => {
    const cases = [
      [{ state: "open" }, "lu-git-pull-request", "text-success", ", open"],
      [{ state: "merged" }, "lu-git-merge", "text-merged", ", merged"],
      [
        { state: "closed" },
        "lu-git-pull-request-closed",
        "text-destructive",
        ", closed",
      ],
      [
        { state: "open", blocked: true },
        "lu-git-merge-conflict",
        "text-destructive",
        ", merge blocked",
      ],
    ] as const
    for (const [pr, glyph, colour, label] of cases) {
      const el = badge({ number: 491, ...pr })
      expect(el.querySelector("svg")?.classList.contains(glyph)).toBe(true)
      expect(el.classList.contains(colour)).toBe(true)
      expect(el.textContent).toBe(`PR #491${label}`)
      cleanup()
    }
  })

  it("only reads blocked on an open PR", () => {
    const el = badge({ number: 470, state: "merged", blocked: true })
    expect(el.querySelector("svg")?.classList.contains("lu-git-merge")).toBe(
      true
    )
    expect(el.textContent).toBe("PR #470, merged")
  })
})

describe("workspacePr", () => {
  it("carries the Workspace's blocked flag", () => {
    expect(
      workspacePr({
        ref: "listing-page",
        status: "running",
        prNumber: 491,
        prState: "open",
        prBlocked: true,
      })
    ).toEqual({ number: 491, state: "open", blocked: true })
  })
})
