// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { DeleteBranchDialog } from "./delete-branch-dialog"

// Radix's AlertDialog uses pointer-capture / scroll APIs jsdom doesn't
// implement, plus a ResizeObserver. Polyfill the bare minimum so the dialog
// can mount + open for assertions.
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

function renderDialog(
  props: Partial<React.ComponentProps<typeof DeleteBranchDialog>> = {}
) {
  const onConfirm = vi.fn().mockResolvedValue(undefined)
  const rendered = render(
    <DeleteBranchDialog
      open
      onOpenChange={vi.fn()}
      branchName="feature-a"
      canDeleteOnRemote
      frameCount={2}
      work={{ onOrigin: true, unpushedCommits: 0, uncommittedFiles: 0 }}
      localBranchKept={false}
      onConfirm={onConfirm}
      {...props}
    />
  )
  return { ...rendered, onConfirm: props.onConfirm ?? onConfirm }
}

const text = () => document.body.textContent ?? ""

describe("DeleteBranchDialog remote-delete offer", () => {
  it("opens with the remote delete off, so Delete is local-only by default", () => {
    const { onConfirm } = renderDialog()

    expect(screen.getByRole("checkbox")).toHaveProperty(
      "dataset.state",
      "unchecked"
    )

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    expect(onConfirm).toHaveBeenCalledWith({ deleteOnRemote: false })
  })

  it("passes the opt-in through once the option is ticked", () => {
    const { onConfirm } = renderDialog()

    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    expect(onConfirm).toHaveBeenCalledWith({ deleteOnRemote: true })
  })

  it("hides the option entirely when the GitHub API can't serve it", () => {
    const { onConfirm } = renderDialog({ canDeleteOnRemote: false })

    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(screen.queryByText(/delete the branch on GitHub/i)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    expect(onConfirm).toHaveBeenCalledWith({ deleteOnRemote: false })
  })

  it("surfaces a thrown delete failure inline and stays open to retry", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("Sandbox busy"))
    renderDialog({ onConfirm })

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    expect(await screen.findByText("Sandbox busy")).toBeDefined()
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined()
  })
})

describe("DeleteBranchDialog says what you lose", () => {
  it("says what goes and what stays in plain sentences", () => {
    renderDialog({ openPrNumber: 482, canDeleteOnRemote: false })

    expect(text()).toContain(
      "Its workspace and 2 frames are deleted. The branch stays on GitHub. PR #482 stays open."
    )
  })

  it("leaves GitHub to the option when it's offered", () => {
    renderDialog({ openPrNumber: 482, localBranchKept: true })

    expect(text()).toContain(
      "Its workspace and 2 frames are deleted. The branch stays on this computer."
    )
    expect(text()).not.toContain("stays open")
    expect(screen.getByText("Closes PR #482")).toBeDefined()
  })

  it("changes nothing but the checkbox when ticked, so the dialog can't jump", () => {
    renderDialog({ openPrNumber: 482, localBranchKept: true })
    const before = text()

    fireEvent.click(screen.getByRole("checkbox"))

    expect(screen.getByRole("checkbox")).toHaveProperty(
      "dataset.state",
      "checked"
    )
    expect(text()).toBe(before)
  })

  it("warns only when the checkout has work that would be lost", () => {
    renderDialog()
    expect(screen.queryByRole("alert")).toBeNull()
    cleanup()

    renderDialog({
      work: { onOrigin: true, unpushedCommits: 2, uncommittedFiles: 0 },
    })
    expect(screen.getByRole("alert").textContent).toBe(
      "2 unpushed commits will be lost."
    )
  })

  it("claims nothing while the checkout is unread or unreadable", () => {
    renderDialog({ work: undefined })
    expect(screen.queryByRole("alert")).toBeNull()
    cleanup()

    renderDialog({ work: null })
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("on the local build keeps the git branch, so only uncommitted files warn", () => {
    renderDialog({
      localBranchKept: true,
      work: { onOrigin: false, unpushedCommits: 4, uncommittedFiles: 1 },
    })

    expect(text()).toContain("The branch stays on this computer.")
    expect(screen.getByRole("alert").textContent).toBe(
      "1 uncommitted file will be lost."
    )
  })
})
