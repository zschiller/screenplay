// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  act,
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
import type { BranchData, RepoData } from "@/lib/types"
import {
  BRANCH_MENU_SECTIONS,
  BranchOverflowMenuContent,
  workspaceMenuLead,
} from "./branch-overflow-menu"
import type { BranchPrInfo } from "@/lib/github-actions"
import {
  prReadiness,
  type PrAvailability,
  type PrReadinessInput,
} from "@/lib/branch/pr-readiness"
import { creatingPrStore, useIsCreatingPr } from "@/lib/creating-pr-store"

// `isLocalBuild` is a compile-time constant, but the build-specific item
// ("Restart sandbox" hidden on local) is read at render through this live
// binding — a getter lets each test pick the build without re-importing the
// module. Defaults to the hosted build; the local-build describe flips it and
// afterEach resets it.
const buildFlag = vi.hoisted(() => ({ local: false }))
vi.mock("@/lib/local-mode", () => ({
  get isLocalBuild() {
    return buildFlag.local
  },
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
    hasChanges = false,
    pr,
    onRetry,
    onRestartDevServer,
    onRestart,
    onRecreate,
    onMarkDone,
    onReopen,
    onCreatePr,
    prAvailability,
  }: {
    isBusy?: boolean
    prAvailability?: PrAvailability
    hasChanges?: boolean
    pr?: BranchPrInfo | null
    onRetry?: () => void
    onRestartDevServer?: () => void
    onRestart?: () => void
    onRecreate?: () => void
    onMarkDone?: () => void
    onReopen?: () => void
    onCreatePr?: () => void
  } = {}
) {
  const shown = { ...branch, ...overrides }
  // What `usePrReadiness` feeds the menu, from these fixtures and the
  // creating-PR store.
  function Menu() {
    const running = useIsCreatingPr(shown.id)
    return (
      <BranchOverflowMenuContent
        branch={shown}
        repo={repo}
        onPlay={vi.fn()}
        onRetry={onRetry ?? vi.fn()}
        prReadiness={{
          ...prReadiness({
            branch: shown,
            pr,
            availability: prAvailability ?? "ready",
            agentWorking: isBusy,
            hasChanges,
            running,
          }),
          run: onCreatePr ?? vi.fn(),
        }}
        onRename={vi.fn()}
        onRestartDevServer={onRestartDevServer ?? vi.fn()}
        onRestart={onRestart ?? vi.fn()}
        onRecreate={onRecreate ?? vi.fn()}
        onShowRoutes={vi.fn()}
        onMarkDone={onMarkDone ?? vi.fn()}
        onReopen={onReopen ?? vi.fn()}
        onDelete={vi.fn()}
        isBusy={isBusy}
      />
    )
  }
  return render(
    <DropdownMenu open>
      <DropdownMenuTrigger>open</DropdownMenuTrigger>
      <Menu />
    </DropdownMenu>
  )
}

afterEach(() => {
  cleanup()
  buildFlag.local = false
})

describe("BRANCH_MENU_SECTIONS skeleton", () => {
  it("declares View, Git, Manage, then Delete", () => {
    expect(BRANCH_MENU_SECTIONS.map((s) => [s.id, s.itemKeys])).toEqual([
      ["view", ["play", "open-in-browser", "routes"]],
      ["git", ["create-pr"]],
      ["manage", ["rename", "restart", "mark-done"]],
      ["danger", ["delete"]],
    ])
  })

  it("contains no git fetch/pull/push/sync items", () => {
    const keys = BRANCH_MENU_SECTIONS.flatMap((s) => s.itemKeys)
    for (const forbidden of ["fetch", "pull", "push", "sync"]) {
      expect(keys).not.toContain(forbidden)
    }
  })
})

describe("workspaceMenuLead", () => {
  const ready = {
    status: "running" as const,
    previewDomain: "foo.dev",
    sandboxName: "sb-1",
    ref: "feature/foo",
  }
  const lead = ({
    branch = ready,
    pr = null,
    hasChanges = false,
    isBusy = false,
    prAvailability = "ready",
  }: {
    branch?: Parameters<typeof workspaceMenuLead>[0]["branch"] &
      PrReadinessInput["branch"]
    pr?: Pick<BranchPrInfo, "state"> | null
    hasChanges?: boolean
    isBusy?: boolean
    prAvailability?: PrAvailability
  } = {}) =>
    workspaceMenuLead({
      branch,
      isBusy,
      prReadiness: prReadiness({
        branch,
        pr: pr && { url: "https://x", number: 1, ...pr },
        availability: prAvailability,
        agentWorking: isBusy,
        hasChanges,
        running: false,
      }),
    })

  it("leads with Retry when setup failed", () => {
    expect(lead({ branch: { ...ready, status: "error" } })).toBe("retry")
    expect(lead({ branch: { ...ready, error: "boom" } })).toBe("retry")
  })

  it("has no lead while the Workspace is being set up or stopped", () => {
    for (const status of ["creating", "starting", "stopped"] as const) {
      expect(lead({ branch: { ...ready, status }, hasChanges: true })).toBe(
        null
      )
    }
  })

  it("leads a Done Workspace with Reopen, whatever else it has", () => {
    expect(
      lead({
        branch: { ...ready, status: "stopped", doneAt: 1 },
        pr: { state: "open" },
        hasChanges: true,
      })
    ).toBe("reopen")
  })

  it("leads with Mark as done once the PR has merged and the agent is idle", () => {
    expect(lead({ pr: { state: "merged" } })).toBe("mark-done")
    expect(lead({ pr: { state: "merged" }, hasChanges: true })).toBe(
      "mark-done"
    )
    expect(
      lead({ branch: { ...ready, status: "stopped" }, pr: { state: "merged" } })
    ).toBe("mark-done")
    expect(lead({ pr: { state: "merged" }, isBusy: true })).toBe("play")
  })

  it("leads with the PR when one is open, or when there are changes", () => {
    expect(lead({ pr: { state: "open" } })).toBe("create-pr")
    expect(lead({ hasChanges: true })).toBe("create-pr")
  })

  it("doesn't lead with Create pull request when GitHub can't take it", () => {
    expect(lead({ hasChanges: true, prAvailability: "none" })).toBe("play")
    expect(lead({ hasChanges: true, prAvailability: "connect" })).toBe("play")
    expect(lead({ pr: { state: "open" }, prAvailability: "none" })).toBe(
      "create-pr"
    )
  })

  it("leads with the player when there's nothing to propose", () => {
    expect(lead()).toBe("play")
    expect(lead({ pr: { state: "closed" } })).toBe("play")
    // Create pull request is disabled mid-turn, so it doesn't lead then.
    expect(lead({ hasChanges: true, isBusy: true })).toBe("play")
  })
})

describe("BranchOverflowMenuContent rendering", () => {
  it("does not render section labels", () => {
    renderMenu()
    // The section skeleton still drives item grouping and separators, but the
    // labels themselves are no longer surfaced in the menu.
    expect(screen.queryByText(/^(View|Git|Manage|Danger)$/)).toBeNull()
  })

  function menuLabels() {
    // Every item and submenu trigger, top to bottom.
    return within(screen.getByRole("menu"))
      .getAllByRole("menuitem")
      .map((el) => el.textContent?.trim())
  }

  it("groups a ready Workspace with the player first", () => {
    renderMenu()
    expect(menuLabels()).toEqual([
      "Open prototype player",
      "Open in browser",
      "Show all routes",
      "Create pull request",
      "Rename",
      "Restart",
      "Mark as done",
      "Delete",
    ])
  })

  it("marks a Workspace done from Manage, but not while its agent works", () => {
    const onMarkDone = vi.fn()
    renderMenu({}, { onMarkDone })
    fireEvent.click(screen.getByText("Mark as done"))
    expect(onMarkDone).toHaveBeenCalledWith("branch-1")
    cleanup()
    renderMenu({}, { isBusy: true })
    expect(
      screen
        .getByText("Mark as done")
        .closest('[role="menuitem"]')
        ?.getAttribute("aria-disabled")
    ).toBe("true")
  })

  it("gives a Done Workspace Reopen and only what works without its sandbox", () => {
    const onReopen = vi.fn()
    renderMenu(
      { status: "stopped", doneAt: 1 },
      { onReopen, hasChanges: true, pr: { number: 7, state: "open", url: "x" } }
    )
    expect(menuLabels()).toEqual([
      "Reopen",
      "Open pull request #7",
      "Rename",
      "Delete",
    ])
    fireEvent.click(screen.getByText("Reopen"))
    expect(onReopen).toHaveBeenCalledWith("branch-1")
  })

  it("leads with Create pull request once there are changes, listed once", () => {
    renderMenu({}, { hasChanges: true })
    const labels = menuLabels()
    expect(labels[0]).toBe("Create pull request")
    expect(labels.filter((l) => l === "Create pull request")).toHaveLength(1)
    expect(labels[1]).toBe("Open prototype player")
  })

  it("leads with the open PR and doesn't offer to create another", () => {
    renderMenu(
      {},
      {
        hasChanges: true,
        pr: { number: 42, state: "open", url: "https://x" },
      }
    )
    const labels = menuLabels()
    expect(labels[0]).toBe("Open pull request #42")
    expect(labels).not.toContain("Create pull request")
  })

  it("leads a failed Workspace with Retry setup, not Rename", () => {
    const onRetry = vi.fn()
    renderMenu({ status: "error", error: "npm ERR!" }, { onRetry })
    expect(menuLabels()[0]).toBe("Retry setup")
    fireEvent.click(screen.getByText("Retry setup"))
    expect(onRetry).toHaveBeenCalledWith("branch-1")
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
function createPrDisabled() {
  return (
    screen
      .getByText("Create pull request")
      .closest('[role="menuitem"]')
      ?.getAttribute("aria-disabled") === "true"
  )
}

describe("Create pull request", () => {
  it("is enabled with changes while the branch is not busy", () => {
    renderMenu(
      { sandboxName: "sb-1", ref: "feature/foo" },
      { isBusy: false, hasChanges: true }
    )
    expect(createPrDisabled()).toBe(false)
  })

  it("is disabled while any member's agent works, saying why", async () => {
    renderMenu(
      { sandboxName: "sb-1", ref: "feature/foo" },
      { isBusy: true, hasChanges: true }
    )
    expect(createPrDisabled()).toBe(true)
    const item = screen
      .getByText("Create pull request")
      .closest('[role="menuitem"]')!
    await act(async () => {
      fireEvent.focus(item.parentElement!)
    })
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "The agent is still working."
    )
  })

  it("runs the create when clicked", () => {
    const onCreatePr = vi.fn()
    renderMenu({}, { hasChanges: true, onCreatePr })
    fireEvent.click(screen.getByText("Create pull request"))
    expect(onCreatePr).toHaveBeenCalledOnce()
  })

  it("links a merged or closed PR instead of offering another", () => {
    for (const state of ["merged", "closed"] as const) {
      renderMenu(
        {},
        { hasChanges: true, pr: { number: 5, state, url: "https://x" } }
      )
      expect(screen.getByText("Open pull request #5")).toBeTruthy()
      expect(screen.queryByText("Create pull request")).toBeNull()
      cleanup()
    }
  })

  it("is hidden on a Done Workspace with no PR", () => {
    renderMenu({ status: "stopped", doneAt: 1 }, { hasChanges: true })
    expect(screen.queryByText("Create pull request")).toBeNull()
  })

  it("is disabled for a branch with no ref to open a PR from", () => {
    renderMenu({ ref: undefined }, { isBusy: false, hasChanges: true })
    expect(createPrDisabled()).toBe(true)
  })

  it("is disabled with nothing to propose", () => {
    renderMenu({ sandboxName: "sb-1", ref: "feature/foo" }, { isBusy: false })
    expect(createPrDisabled()).toBe(true)
  })

  it("shows a create already running, disabled", async () => {
    let settle!: () => void
    const run = creatingPrStore.run(
      "b1",
      () => new Promise<void>((r) => (settle = r))
    )
    renderMenu(
      { id: "b1", sandboxName: "sb-1", ref: "feature/foo" },
      { isBusy: false, hasChanges: true }
    )
    const item = screen
      .getByText("Creating pull request…")
      .closest('[role="menuitem"]')
    expect(item?.getAttribute("aria-disabled")).toBe("true")
    await act(async () => {
      settle()
      await run
    })
    expect(createPrDisabled()).toBe(false)
  })

  it("is hidden when the repo can't open a PR, but an open PR still links", () => {
    renderMenu({}, { hasChanges: true, prAvailability: "none" })
    expect(screen.queryByText("Create pull request")).toBeNull()
    cleanup()
    renderMenu(
      {},
      {
        prAvailability: "none",
        pr: { number: 9, state: "open", url: "https://x" },
      }
    )
    expect(screen.getByText("Open pull request #9")).toBeTruthy()
  })
})

describe("Create pull request without a GitHub connection (H3)", () => {
  it("shows disabled, its tooltip pointing at Settings", async () => {
    renderMenu({}, { hasChanges: true, prAvailability: "connect" })
    const item = screen
      .getByText("Create pull request")
      .closest('[role="menuitem"]')!
    expect(item.getAttribute("aria-disabled")).toBe("true")
    await act(async () => {
      fireEvent.focus(item.parentElement!)
    })
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Connect GitHub in Settings to open pull requests."
    )
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

  // On the local (desktop) build the backend runs worktrees on the host, not
  // VMs, so there's nothing to snapshot-restore — "Restart sandbox" would only
  // ever fail loud. The two honest local tiers are "Restart dev server" and
  // "Recreate from scratch", so the VM-cycle item is omitted there.
  describe("local build", () => {
    it("omits Restart sandbox but keeps dev-server restart and recreate", () => {
      buildFlag.local = true
      renderMenu()
      openSubmenu()
      expect(submenuItem("Restart sandbox")).toBeUndefined()
      expect(submenuItem("Restart dev server")).toBeDefined()
      expect(submenuItem("Recreate from scratch")).toBeDefined()
    })
  })
})
