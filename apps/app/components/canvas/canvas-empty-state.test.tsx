// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, renderHook, screen } from "@testing-library/react"

import type { RepoNaming } from "@/lib/repo-identity"

import { CanvasEmptyState, emptyCanvasDescription } from "./canvas-empty-state"
import { useToolMode } from "./use-tool-mode"

vi.mock("@/lib/local-mode", () => ({ isLocalBuild: false }))

afterEach(cleanup)

function repo(fullName: string, extra: Partial<RepoNaming> = {}): RepoNaming {
  const [repoOwner = "", repoName = ""] = fullName.split("/")
  return { repoOwner, repoName, repoFullName: fullName, ...extra }
}

function renderEmptyState(repos: RepoNaming[]) {
  const { result } = renderHook(() =>
    useToolMode({ frameAvailable: repos.length > 0 })
  )
  return render(<CanvasEmptyState toolMode={result.current} repos={repos} />)
}

function rowNames() {
  return screen.getAllByRole("button").map((b) => b.textContent)
}

describe("CanvasEmptyState", () => {
  it("keeps today's four rows on a canvas with no repository", () => {
    renderEmptyState([])
    expect(rowNames()).toEqual([
      "Add a frame",
      "Add a mockupM",
      "Add a documentD",
      "Add a repository",
    ])
    expect(
      screen
        .getByRole("button", { name: /Add a frame/ })
        .hasAttribute("disabled")
    ).toBe(true)
    screen.getByText(
      "Frames preview a chat’s code, mockups sketch a page before it’s built, documents hold notes and specs, and a repository holds the code they run."
    )
  })

  it("shows the three tools with their keys and names the repositories", () => {
    renderEmptyState([repo("acme/storefront"), repo("acme/web")])
    expect(rowNames()).toEqual([
      "Add a frameF",
      "Add a mockupM",
      "Add a documentD",
    ])
    expect(
      screen
        .getByRole("button", { name: /Add a frame/ })
        .hasAttribute("disabled")
    ).toBe(false)
    screen.getByText(
      "Frames preview acme/storefront and acme/web, mockups sketch a page before it’s built, and documents hold notes and specs."
    )
  })
})

describe("emptyCanvasDescription", () => {
  const tail =
    ", mockups sketch a page before it’s built, and documents hold notes and specs."

  it("names one repository alone", () => {
    expect(emptyCanvasDescription([repo("acme/web")])).toBe(
      `Frames preview acme/web${tail}`
    )
  })

  it("joins two with “and”", () => {
    expect(
      emptyCanvasDescription([repo("acme/storefront"), repo("acme/web")])
    ).toBe(`Frames preview acme/storefront and acme/web${tail}`)
  })

  it("lists three or more with a final “and”", () => {
    expect(
      emptyCanvasDescription([
        repo("acme/storefront"),
        repo("acme/web"),
        repo("acme/api"),
      ])
    ).toBe(`Frames preview acme/storefront, acme/web, and acme/api${tail}`)
  })

  it("names a repository on the canvas twice once", () => {
    expect(
      emptyCanvasDescription([
        repo("acme/web"),
        repo("acme/web", { name: "docs" }),
      ])
    ).toBe(`Frames preview acme/web${tail}`)
  })

  it("names a remote-less folder by its folder name", () => {
    expect(
      emptyCanvasDescription([
        repo("", { repoFullName: "", localPath: "/Users/me/code/site" }),
      ])
    ).toBe(`Frames preview site${tail}`)
  })
})
