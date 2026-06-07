// @vitest-environment jsdom
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { CreateBranchDialog } from "@/components/create-branch-dialog"
import type { BranchData, RepoData } from "@/lib/types"
import {
  BRANCH_MENU_SECTIONS,
  BranchOverflowMenuContent,
} from "./branch-overflow-menu"

// The create dialog's base picker reaches GitHub through `github-actions`,
// which transitively imports the server-only auth/db stack (needs DATABASE_URL).
// The picker only mounts when its popover is opened — never in these tests — so
// stub the module to keep the import graph client-only.
vi.mock("@/lib/github-actions", () => ({
  listRepoBranches: vi.fn().mockResolvedValue([]),
}))

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

function renderMenu(
  overrides: Partial<BranchData> = {},
  {
    isBusy = false,
    onRestartDevServer,
    onRestart,
    onRecreate,
  }: {
    isBusy?: boolean
    onRestartDevServer?: () => void
    onRestart?: () => void
    onRecreate?: () => void
  } = {}
) {
  return render(
    <DropdownMenu open>
      <DropdownMenuTrigger>open</DropdownMenuTrigger>
      <BranchOverflowMenuContent
        branch={{ ...branch, ...overrides }}
        repo={repo}
        onPlay={vi.fn()}
        onRename={vi.fn()}
        onUpdateBranch={vi.fn()}
        onNewBranchFromHere={vi.fn()}
        onRestartDevServer={onRestartDevServer ?? vi.fn()}
        onRestart={onRestart ?? vi.fn()}
        onRecreate={onRecreate ?? vi.fn()}
        onShowRoutes={vi.fn()}
        onCreatePr={vi.fn()}
        onRebase={vi.fn()}
        onDelete={vi.fn()}
        isBusy={isBusy}
      />
    </DropdownMenu>
  )
}

function rebaseItem() {
  return screen.getByText("Rebase on main").closest('[role="menuitem"]')
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
    expect(bySection["branch-sandbox"]).toEqual([
      "new-branch-from-here",
      "restart",
    ])
    expect(bySection.git).toEqual(["create-pr", "rebase", "open-github"])
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
      "New branch from here…",
      "Restart",
      "Git",
      "Create pull request",
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
    // Match whole-label items only — "Create pull request" legitimately
    // contains "pull" but isn't one of the redundant always-push actions.
    expect(screen.queryByText(/^(Fetch|Pull|Push|Sync)$/i)).toBeNull()
  })
})

// Radix marks a disabled menu item with `aria-disabled="true"` (and a bare
// `data-disabled` attribute); an enabled item carries neither. No jest-dom is
// wired up, so assert the attribute directly.
function isRebaseDisabled() {
  return rebaseItem()?.getAttribute("aria-disabled") === "true"
}

describe("Rebase on main — disable while working", () => {
  it("is enabled when the branch is not busy", () => {
    renderMenu({}, { isBusy: false })
    expect(isRebaseDisabled()).toBe(false)
  })

  it("is disabled when the branch is busy", () => {
    renderMenu({}, { isBusy: true })
    expect(isRebaseDisabled()).toBe(true)
  })

  it("stays disabled while busy even with a sandbox + ref present", () => {
    // Guards against the disable collapsing to only the data-availability
    // checks (`sandboxName`/`ref`) and dropping the busy gate.
    renderMenu({ sandboxName: "sb-1", ref: "feature/foo" }, { isBusy: true })
    expect(isRebaseDisabled()).toBe(true)
  })
})

function createPrDisabled() {
  return (
    screen
      .getByText("Create pull request")
      .closest('[role="menuitem"]')
      ?.getAttribute("aria-disabled") === "true"
  )
}

describe("Create pull request — disable while working", () => {
  it("is enabled when the branch is not busy", () => {
    renderMenu({ sandboxName: "sb-1", ref: "feature/foo" }, { isBusy: false })
    expect(createPrDisabled()).toBe(false)
  })

  it("is disabled when the branch is busy", () => {
    renderMenu({ sandboxName: "sb-1", ref: "feature/foo" }, { isBusy: true })
    expect(createPrDisabled()).toBe(true)
  })

  it("is disabled for a branch with no ref to open a PR from", () => {
    renderMenu({ ref: undefined }, { isBusy: false })
    expect(createPrDisabled()).toBe(true)
  })
})

// ProseMirror (the dialog's Composer) reaches for a couple of Range APIs jsdom
// leaves unimplemented; stub them so the editor can mount empty.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => ({}) as DOMRect
}

/**
 * Mirrors the RoomSidebar wiring (#353): the branch menu's "New branch from
 * here…" item seeds `baseBranch` with the source branch's ref and opens the
 * real {@link CreateBranchDialog}. Rendering both together lets the test assert
 * the end-to-end behaviour — the item opens the dialog, pre-based on the branch,
 * with an empty prompt — rather than just that a callback fired.
 */
function MenuToDialogHarness() {
  const [base, setBase] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <DropdownMenu open>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <BranchOverflowMenuContent
          branch={branch}
          repo={repo}
          onPlay={vi.fn()}
          onRename={vi.fn()}
          onUpdateBranch={vi.fn()}
          onNewBranchFromHere={() => {
            setBase(branch.ref ?? null)
            setOpen(true)
          }}
          onRestartDevServer={vi.fn()}
          onRestart={vi.fn()}
          onRecreate={vi.fn()}
          onShowRoutes={vi.fn()}
          onCreatePr={vi.fn()}
          onRebase={vi.fn()}
          onDelete={vi.fn()}
        />
      </DropdownMenu>
      {open ? (
        <CreateBranchDialog
          open
          onOpenChange={setOpen}
          defaultBranch={repo.defaultBranch}
          baseBranch={base ?? undefined}
          repoOwner={repo.repoOwner}
          repoName={repo.repoName}
          markdownLayers={[]}
          onSubmit={vi.fn()}
        />
      ) : null}
    </>
  )
}

describe('"New branch from here…" opens the create dialog', () => {
  it("opens it pre-based on this branch with an empty prompt", async () => {
    render(<MenuToDialogHarness />)

    // No dialog until the item is chosen.
    expect(screen.queryByText("Create branches")).toBeNull()

    fireEvent.click(screen.getByText("New branch from here…"))

    // The create dialog is now open…
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).queryByText("Create branches")).not.toBeNull()
    // …pre-based on this branch (the base chip shows its ref, not the default)…
    expect(within(dialog).queryByText(branch.ref)).not.toBeNull()
    expect(within(dialog).queryByText(repo.defaultBranch)).toBeNull()
    // …and with an empty prompt (the source branch's chat is not carried over).
    const editor = dialog.querySelector('[contenteditable="true"]')
    expect(editor?.textContent ?? "").toBe("")
  })

  it("is disabled for a branch with no ref to fork from", () => {
    renderMenu({ ref: undefined })
    const item = screen
      .getByText("New branch from here…")
      .closest("[role=menuitem]")
    expect(item?.getAttribute("aria-disabled")).toBe("true")
  })
})

describe("Restart submenu", () => {
  it("renders Restart as a submenu trigger, not a flat action", () => {
    renderMenu()
    // A submenu trigger advertises a nested menu via aria-haspopup; a plain
    // DropdownMenuItem does not. That's the structural tell that "Restart" was
    // converted from one button into a submenu.
    const restart = screen.getByText("Restart").closest("[role='menuitem']")
    expect(restart).not.toBeNull()
    expect(restart?.getAttribute("aria-haspopup")).toBe("menu")
  })

  it("lists Restart dev server first and keeps it enabled", () => {
    renderMenu()
    // Open the submenu by activating its trigger from the keyboard — Radix opens
    // a sub-content on ArrowRight, which jsdom can drive without real hover.
    const trigger = screen.getByText("Restart").closest("[role='menuitem']")!
    fireEvent.keyDown(trigger, { key: "ArrowRight" })

    const items = screen
      .getAllByRole("menuitem")
      .map((el) => el.textContent?.trim())
    const devIdx = items.indexOf("Restart dev server")
    const sandboxIdx = items.indexOf("Restart sandbox")
    expect(devIdx).toBeGreaterThanOrEqual(0)
    // Dev server is the submenu's first item, ahead of Restart sandbox.
    expect(sandboxIdx).toBeGreaterThan(devIdx)

    // It stays enabled (no data-disabled / aria-disabled) so a wedged preview
    // can be fixed even while the agent is working.
    const devItem = screen
      .getAllByRole("menuitem")
      .find((el) => el.textContent?.trim() === "Restart dev server")!
    expect(devItem.getAttribute("data-disabled")).toBeNull()
    expect(devItem.getAttribute("aria-disabled")).not.toBe("true")
  })

  it("invokes the dev-server restart handler with the branch id", () => {
    const onRestartDevServer = vi.fn()
    renderMenu({}, { onRestartDevServer })
    const trigger = screen.getByText("Restart").closest("[role='menuitem']")!
    fireEvent.keyDown(trigger, { key: "ArrowRight" })
    const devItem = screen
      .getAllByRole("menuitem")
      .find((el) => el.textContent?.trim() === "Restart dev server")!
    fireEvent.click(devItem)
    expect(onRestartDevServer).toHaveBeenCalledWith("branch-1")
  })

  function openSubmenu() {
    const trigger = screen.getByText("Restart").closest("[role='menuitem']")!
    fireEvent.keyDown(trigger, { key: "ArrowRight" })
  }

  function submenuItem(label: string) {
    return screen
      .getAllByRole("menuitem")
      .find((el) => el.textContent?.trim() === label)
  }

  it("lists Recreate from scratch last, after Restart sandbox", () => {
    renderMenu()
    openSubmenu()
    const items = screen
      .getAllByRole("menuitem")
      .map((el) => el.textContent?.trim())
    const sandboxIdx = items.indexOf("Restart sandbox")
    const recreateIdx = items.indexOf("Recreate from scratch")
    expect(recreateIdx).toBeGreaterThan(sandboxIdx)
  })

  it("invokes the recreate handler with the branch id", () => {
    const onRecreate = vi.fn()
    renderMenu({}, { onRecreate })
    openSubmenu()
    fireEvent.click(submenuItem("Recreate from scratch")!)
    expect(onRecreate).toHaveBeenCalledWith("branch-1")
  })

  it("disables Restart sandbox and Recreate while busy, but not Restart dev server", () => {
    renderMenu({}, { isBusy: true })
    openSubmenu()
    // Dev server stays enabled mid-turn — the one restart that can fix a wedged
    // preview without cycling the VM.
    expect(
      submenuItem("Restart dev server")?.getAttribute("aria-disabled")
    ).not.toBe("true")
    // The two VM-cycling actions are gated while the agent works.
    expect(submenuItem("Restart sandbox")?.getAttribute("aria-disabled")).toBe(
      "true"
    )
    expect(
      submenuItem("Recreate from scratch")?.getAttribute("aria-disabled")
    ).toBe("true")
  })
})
