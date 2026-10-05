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
  type BranchMenuPart,
  workspaceMenuLead,
} from "./branch-overflow-menu"
import type { BranchPrInfo } from "@/lib/github-actions"
import {
  prReadiness,
  type PrAvailability,
  type PrReadinessInput,
} from "@/lib/branch/pr-readiness"
import { creatingPrStore, useIsCreatingPr } from "@/lib/creating-pr-store"

const openExternal = vi.hoisted(() => vi.fn())
vi.mock("@/lib/open-external", () => ({ openExternal }))

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
    onRecreate,
    part,
    onOpenLogs,
    onOpenChat,
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
    onRecreate?: () => void
    part?: BranchMenuPart
    onOpenLogs?: () => void
    onOpenChat?: () => void
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
        onRecreate={onRecreate ?? vi.fn()}
        onShowRoutes={vi.fn()}
        onMarkDone={onMarkDone ?? vi.fn()}
        onReopen={onReopen ?? vi.fn()}
        onDelete={vi.fn()}
        isBusy={isBusy}
        part={part}
        onOpenLogs={onOpenLogs}
        onOpenChat={onOpenChat}
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
})

function menuLabels() {
  // Every item and submenu trigger, top to bottom.
  return within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map((el) => el.textContent?.trim())
}

describe("BRANCH_MENU_SECTIONS skeleton", () => {
  it("declares Open, View, Recover, Git, Pull requests, Manage, then Delete", () => {
    expect(BRANCH_MENU_SECTIONS.map((s) => [s.id, s.itemKeys])).toEqual([
      ["open", ["open-chat"]],
      ["view", ["play", "open-in-browser", "routes", "logs"]],
      ["recover", ["restart-preview", "set-up-again"]],
      ["git", ["create-pr"]],
      ["pull-requests", ["pull-requests"]],
      ["manage", ["rename", "mark-done"]],
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

  it("leads with Create pull request when there are changes", () => {
    expect(lead({ hasChanges: true })).toBe("create-pr")
  })

  it("doesn't lead with an open PR: its own group lists it (#1701)", () => {
    expect(lead({ pr: { state: "open" } })).toBe("play")
  })

  it("doesn't lead with Create pull request when GitHub can't take it", () => {
    expect(lead({ hasChanges: true, prAvailability: "none" })).toBe("play")
    expect(lead({ hasChanges: true, prAvailability: "connect" })).toBe("play")
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

  it("groups a ready Workspace with the player first", () => {
    renderMenu()
    expect(menuLabels()).toEqual([
      "Open in prototype player",
      "Open in browser",
      "Show all routes",
      "Restart preview",
      "Set up again…",
      "Create pull request",
      "Rename",
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
      "Pull request #7, open",
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
    expect(labels[1]).toBe("Open in prototype player")
  })

  it("lists the open PR under Pull requests and doesn't offer to create another", () => {
    renderMenu(
      {},
      {
        hasChanges: true,
        pr: { number: 42, state: "open", url: "https://x" },
      }
    )
    const labels = menuLabels()
    expect(labels).toContain("Pull request #42, open")
    expect(labels).not.toContain("Create pull request")
    expect(screen.getByText("Pull requests")).toBeTruthy()
  })

  it("leads a failed Workspace with Set up again, standing in for the confirming one", () => {
    const onRetry = vi.fn()
    renderMenu({ status: "error", error: "npm ERR!" }, { onRetry })
    const labels = menuLabels()
    expect(labels[0]).toBe("Set up again")
    expect(labels).not.toContain("Set up again…")
    fireEvent.click(screen.getByText("Set up again"))
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

  it("lists a merged PR instead of offering another, until the Branch moves past it", () => {
    const merged = {
      prNumber: 5,
      prState: "merged" as const,
      prUrl: "https://x",
    }
    const pr = { number: 5, state: "merged" as const, url: "https://x" }
    renderMenu(merged, { hasChanges: true, pr })
    expect(menuLabels()).toContain("Pull request #5, merged")
    expect(screen.queryByText("Create pull request")).toBeNull()
    cleanup()
    // The next turn after the merge moved it onto the latest code (#1701).
    renderMenu({ ...merged, prMovedPast: 5 }, { hasChanges: true, pr })
    expect(menuLabels()).toContain("Pull request #5, merged")
    expect(screen.getByText("Create pull request")).toBeTruthy()
  })

  it("offers the next PR after a closed one, still listing it", () => {
    renderMenu(
      { prNumber: 5, prState: "closed", prUrl: "https://x" },
      { hasChanges: true, pr: { number: 5, state: "closed", url: "https://x" } }
    )
    expect(menuLabels()).toContain("Pull request #5, closed")
    expect(screen.getByText("Create pull request")).toBeTruthy()
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
    expect(menuLabels()).toContain("Pull request #9, open")
  })
})

describe("Pull requests group (#1701)", () => {
  it("lists every PR the Workspace opened, newest first, each opening on GitHub", () => {
    renderMenu(
      {
        prNumber: 497,
        prState: "open",
        prUrl: "https://github.com/acme/widgets/pull/497",
        prTitle: "Apple Pay",
        pastPrs: [
          {
            number: 482,
            url: "https://github.com/acme/widgets/pull/482",
            title: "One-scroll checkout",
            state: "merged",
          },
        ],
      },
      {
        pr: {
          number: 497,
          state: "open",
          url: "https://github.com/acme/widgets/pull/497",
        },
      }
    )
    const rows = menuLabels().filter((l) => l?.startsWith("Pull request"))
    expect(rows).toEqual([
      "Pull request #497, openApple Pay",
      "Pull request #482, mergedOne-scroll checkout",
    ])
    fireEvent.click(screen.getByText("One-scroll checkout"))
    expect(openExternal).toHaveBeenCalledWith(
      "https://github.com/acme/widgets/pull/482"
    )
  })

  it("is left out for a Workspace with no PR", () => {
    renderMenu()
    expect(screen.queryByText("Pull requests")).toBeNull()
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

describe("Recover items", () => {
  function item(label: string) {
    return screen
      .getAllByRole("menuitem")
      .find((el) => el.textContent?.trim() === label)
  }

  it("offers Restart preview and Set up again… flat, with no Restart sandbox", () => {
    renderMenu()
    const labels = menuLabels()
    expect(labels.indexOf("Set up again…")).toBe(
      labels.indexOf("Restart preview") + 1
    )
    expect(labels).not.toContain("Restart")
    expect(labels).not.toContain("Restart sandbox")
  })

  it("restarts the preview with the branch id, even while the agent works", () => {
    const onRestartDevServer = vi.fn()
    renderMenu({}, { onRestartDevServer, isBusy: true })
    expect(item("Restart preview")?.getAttribute("aria-disabled")).not.toBe(
      "true"
    )
    fireEvent.click(item("Restart preview")!)
    expect(onRestartDevServer).toHaveBeenCalledWith("branch-1")
  })

  it("sets up again through the recreate confirm, but not while busy", () => {
    const onRecreate = vi.fn()
    renderMenu({}, { onRecreate })
    fireEvent.click(item("Set up again…")!)
    expect(onRecreate).toHaveBeenCalledWith("branch-1")
    cleanup()
    renderMenu({}, { isBusy: true })
    expect(item("Set up again…")?.getAttribute("aria-disabled")).toBe("true")
  })
})

describe("A frame's halves", () => {
  it("Preview: the running app's items, Open logs, and recovery", () => {
    const onOpenLogs = vi.fn()
    renderMenu({}, { part: "preview", onOpenLogs, hasChanges: true })
    expect(menuLabels()).toEqual([
      "Open in prototype player",
      "Open in browser",
      "Add frames for all routes",
      "Open logs",
      "Restart preview",
      "Set up again…",
    ])
    fireEvent.click(screen.getByText("Open logs"))
    expect(onOpenLogs).toHaveBeenCalled()
  })

  it("Preview leads a failed setup with Set up again", () => {
    renderMenu({ status: "error", error: "npm ERR!" }, { part: "preview" })
    expect(menuLabels()[0]).toBe("Set up again")
  })

  it("Chat: Open chat first, then the chat's own items, Delete chat last", () => {
    const onOpenChat = vi.fn()
    renderMenu({}, { part: "chat", onOpenChat, hasChanges: true })
    expect(menuLabels()).toEqual([
      "Open chat",
      "Create pull request",
      "Rename",
      "Mark as done",
      "Delete chat",
    ])
    fireEvent.click(screen.getByText("Open chat"))
    expect(onOpenChat).toHaveBeenCalled()
  })

  it("Chat never offers Reopen: a Done chat's frames are hidden", () => {
    renderMenu({ status: "stopped", doneAt: 1 }, { part: "chat" })
    expect(menuLabels()).not.toContain("Reopen")
  })
})
