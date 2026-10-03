// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  DeleteRepoDialog,
  removeDescription,
  type DeleteRepoWorkspace,
} from "./delete-repo-dialog"
import {
  roomWorkspaceFacts,
  workspaceState,
} from "@/lib/branch/workspace-state"

// Radix's AlertDialog uses pointer-capture / scroll APIs jsdom doesn't
// implement, plus a ResizeObserver. Polyfill the bare minimum.
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

afterEach(cleanup)

const clean = { onOrigin: true, unpushedCommits: 0, uncommittedFiles: 0 }
const idleRoom = roomWorkspaceFacts([], [])
const withState = (w: Omit<DeleteRepoWorkspace, "state">) => ({
  ...w,
  state: workspaceState(w, idleRoom),
})
const WORKSPACES: DeleteRepoWorkspace[] = (
  [
    {
      id: "a",
      ref: "checkout-polish",
      title: "Checkout polish",
      status: "running",
      prNumber: 482,
      prState: "open",
      openPrNumber: 482,
      work: clean,
    },
    {
      id: "b",
      ref: "empty-cart-state",
      title: "Empty cart state",
      status: "running",
      work: { onOrigin: true, unpushedCommits: 2, uncommittedFiles: 0 },
    },
    { id: "c", ref: "apple-pay-button", status: "stopped", work: clean },
  ] satisfies Omit<DeleteRepoWorkspace, "state">[]
).map(withState)

function renderDialog(
  props: Partial<React.ComponentProps<typeof DeleteRepoDialog>> = {}
) {
  const onConfirm = vi.fn().mockResolvedValue(undefined)
  render(
    <DeleteRepoDialog
      open
      onOpenChange={vi.fn()}
      repoName="storefront"
      workspaces={WORKSPACES}
      canDeleteOnRemote
      localBranchKept={false}
      onConfirm={onConfirm}
      {...props}
    />
  )
  return { onConfirm: props.onConfirm ?? onConfirm }
}

describe("DeleteRepoDialog", () => {
  it("lists each workspace with its state", () => {
    renderDialog()

    const rows = screen.getAllByRole("listitem").map((li) => li.textContent)
    expect(rows).toEqual([
      "Checkout polishPR #482, open",
      "Empty cart state2 unpushed",
      // Untitled: never its branch (#1182).
      "New chatClean",
    ])
    expect(
      screen.getAllByRole("img").map((i) => i.getAttribute("aria-label"))
    ).toEqual(["Ready", "Ready", "Stopped"])
  })

  it("warns about unpushed work only when some would be lost", () => {
    renderDialog()
    expect(screen.getByRole("alert").textContent).toBe(
      "Unpushed work in 1 workspace will be lost."
    )
    cleanup()

    renderDialog({ localBranchKept: true })
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("defaults the GitHub delete off", () => {
    const { onConfirm } = renderDialog()

    expect(screen.getByRole("checkbox")).toHaveProperty(
      "dataset.state",
      "unchecked"
    )
    fireEvent.click(screen.getByRole("button", { name: "Remove" }))

    expect(onConfirm).toHaveBeenCalledWith({ deleteBranchesOnRemote: false })
  })

  it("passes the opt-in through once ticked", () => {
    const { onConfirm } = renderDialog()

    expect(
      screen.getByText("Also delete these 3 branches on GitHub")
    ).toBeDefined()
    expect(screen.getByText("Closes PR #482")).toBeDefined()
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Remove" }))

    expect(onConfirm).toHaveBeenCalledWith({ deleteBranchesOnRemote: true })
  })

  it("doesn't offer the GitHub delete when it can't work", () => {
    renderDialog({ canDeleteOnRemote: false })

    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("says chats, and on a shared canvas that it goes for everyone", () => {
    expect(removeDescription(0)).toBe(
      "The repository is removed from this canvas."
    )
    expect(removeDescription(1)).toBe(
      "Its chat is removed from this canvas, with its frames."
    )
    expect(removeDescription(3)).toBe(
      "Its 3 chats are removed from this canvas, with their frames."
    )
    expect(removeDescription(0, { sharedCanvas: true })).toBe(
      "It's removed for everyone on this canvas, with any changes made here."
    )
    expect(
      removeDescription(3, { sharedCanvas: true, addedByName: "Ana" })
    ).toBe(
      "It's removed for everyone on this canvas, with any changes made here. Its 3 chats and their frames go too. Ana added it."
    )
  })
})
