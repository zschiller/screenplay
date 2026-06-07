// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import type { BranchData, RepoData } from "@/lib/types"
import {
  BRANCH_MENU_SECTIONS,
  BranchOverflowMenuContent,
} from "./branch-overflow-menu"

// Radix's dropdown content positions itself with floating-ui, which needs a
// ResizeObserver, and uses pointer-capture APIs jsdom doesn't implement.
// Polyfill the bare minimum so the menu can mount + open for assertions.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
}

const repo: RepoData = {
  id: "repo-1",
  name: "",
  repoFullName: "acme/widgets",
  repoOwner: "acme",
  repoName: "widgets",
  defaultBranch: "main",
  cloneUrl: "https://github.com/acme/widgets.git",
  setupScript: "",
  devScript: "",
  devServerPort: 3000,
  envVars: "",
  createdAt: 0,
}

const branch: BranchData = {
  id: "branch-1",
  repoId: "repo-1",
  sandboxName: "sb-1",
  gitUrl: "https://github.com/acme/widgets.git",
  ref: "feature/foo",
  previewDomain: "foo.example.dev",
  port: 3000,
  status: "running",
  createdAt: 0,
  discoveredRoutes: [{ route: "/", label: "Home" }],
}

function renderMenu(overrides: Partial<BranchData> = {}) {
  return render(
    <DropdownMenu open>
      <DropdownMenuTrigger>open</DropdownMenuTrigger>
      <BranchOverflowMenuContent
        branch={{ ...branch, ...overrides }}
        repo={repo}
        onPlay={vi.fn()}
        onRename={vi.fn()}
        onUpdateBranch={vi.fn()}
        onDuplicate={vi.fn()}
        onRestart={vi.fn()}
        onShowRoutes={vi.fn()}
        onRebase={vi.fn()}
        onDelete={vi.fn()}
      />
    </DropdownMenu>
  )
}

afterEach(cleanup)

describe("BRANCH_MENU_SECTIONS skeleton", () => {
  it("declares the five sections in order", () => {
    expect(BRANCH_MENU_SECTIONS.map((s) => s.id)).toEqual([
      "identity",
      "preview",
      "branch-sandbox",
      "git",
      "danger",
    ])
    expect(BRANCH_MENU_SECTIONS.map((s) => s.label)).toEqual([
      "Identity",
      "Preview",
      "Branch & sandbox",
      "Git",
      "Danger",
    ])
  })

  it("assigns each existing item to its section", () => {
    const bySection = Object.fromEntries(
      BRANCH_MENU_SECTIONS.map((s) => [s.id, s.itemKeys])
    )
    expect(bySection.identity).toEqual(["rename", "color"])
    expect(bySection.preview).toEqual(["play", "routes"])
    expect(bySection["branch-sandbox"]).toEqual(["duplicate", "restart"])
    expect(bySection.git).toEqual(["rebase", "open-github"])
    expect(bySection.danger).toEqual(["delete"])
  })

  it("contains no git fetch/pull/push/sync items", () => {
    const keys = BRANCH_MENU_SECTIONS.flatMap((s) => s.itemKeys)
    for (const forbidden of ["fetch", "pull", "push", "sync"]) {
      expect(keys).not.toContain(forbidden)
    }
  })
})

describe("BranchOverflowMenuContent rendering", () => {
  it("renders the five section labels in order", () => {
    renderMenu()
    const labels = screen
      .getAllByText(/^(Identity|Preview|Branch & sandbox|Git|Danger)$/)
      .map((el) => el.textContent)
    expect(labels).toEqual([
      "Identity",
      "Preview",
      "Branch & sandbox",
      "Git",
      "Danger",
    ])
  })

  it("renders each action under its assigned section, in order", () => {
    renderMenu()
    // The whole menu is one flat DOM order: section label, then its items,
    // then the next label. Reading every label + item top-to-bottom should
    // reproduce the skeleton exactly.
    const expectedSequence = [
      "Identity",
      "Rename",
      "Color",
      "Preview",
      "Open prototype player",
      "Show all routes",
      "Branch & sandbox",
      "Duplicate branch",
      "Restart",
      "Git",
      "Rebase on main",
      "Open branch on GitHub",
      "Danger",
      "Delete",
    ]
    const menu = screen.getByRole("menu")
    const seen = within(menu)
      .getAllByText(
        new RegExp(
          `^(${expectedSequence
            .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|")})$`
        )
      )
      .map((el) => el.textContent)
    expect(seen).toEqual(expectedSequence)
  })

  it("does not surface git fetch/pull/push/sync actions", () => {
    renderMenu()
    expect(screen.queryByText(/fetch|pull|push|sync/i)).toBeNull()
  })
})
