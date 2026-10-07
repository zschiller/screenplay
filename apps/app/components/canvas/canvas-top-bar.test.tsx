// @vitest-environment jsdom
import { createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { CanvasTopBar } from "./canvas-top-bar"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("@/lib/rooms-actions", () => ({ deleteRoom: vi.fn() }))

afterEach(cleanup)

// EditableText starts editing on two quick primary presses.
function doublePress(el: HTMLElement) {
  fireEvent.pointerDown(el, { button: 0 })
  fireEvent.pointerDown(el, { button: 0 })
}

const PAGES = [
  { id: "p1", name: "Homepage", order: 0 },
  { id: "p2", name: "Pricing", order: 1 },
]

function renderBar(
  isOwner: boolean,
  onOpenShortcuts = vi.fn(),
  { sidebarCollapsed = false, onSelectPage = vi.fn(), onAddPage = vi.fn() } = {}
) {
  render(
    <CanvasTopBar
      roomId="r1"
      isOwner={isOwner}
      sharedWithCount={1}
      parentFolder={null}
      currentRoomName="Checkout flow"
      onRoomRename={vi.fn()}
      sidebarCollapsed={sidebarCollapsed}
      trafficLightsPresent={false}
      sidebarPanelRef={createRef()}
      roomNameEditableRef={createRef()}
      pendingRoomRenameRef={{ current: false }}
      onRoomMenuCloseAutoFocus={vi.fn()}
      deleteDialogOpen={false}
      onDeleteDialogOpenChange={vi.fn()}
      onOpenSettings={vi.fn()}
      onOpenShortcuts={onOpenShortcuts}
      stopRoomDevServers={vi.fn()}
      flushLayout={() => Promise.resolve()}
      pages={PAGES}
      currentPageId="p1"
      onSelectPage={onSelectPage}
      onAddPage={onAddPage}
    />
  )
}

describe("CanvasTopBar", () => {
  it("lets the owner rename the canvas by double-clicking its name", () => {
    renderBar(true)
    doublePress(screen.getByText("Checkout flow"))
    expect(screen.getByRole("textbox")).toBeTruthy()
  })

  it("doesn't offer a rename a collaborator's server call would refuse", () => {
    renderBar(false)
    doublePress(screen.getByText("Checkout flow"))
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("opens the shortcut sheet from the canvas menu, owner or not", () => {
    for (const isOwner of [true, false]) {
      const onOpenShortcuts = vi.fn()
      renderBar(isOwner, onOpenShortcuts)
      fireEvent.pointerDown(
        screen.getByRole("button", { name: "Canvas options" }),
        { button: 0, pointerType: "mouse" }
      )
      const item = screen.getByRole("menuitem", { name: /Keyboard shortcuts/ })
      expect(item.textContent).toContain("?")
      fireEvent.click(item)
      expect(onOpenShortcuts).toHaveBeenCalledTimes(1)
      cleanup()
    }
  })

  it("shows the page only while the sidebar is hidden", () => {
    renderBar(true)
    expect(screen.queryByRole("button", { name: "Page: Homepage" })).toBeNull()
    cleanup()
    renderBar(true, vi.fn(), { sidebarCollapsed: true })
    expect(screen.getByRole("button", { name: "Page: Homepage" })).toBeTruthy()
  })

  it("switches pages and adds one from the page menu", () => {
    const onSelectPage = vi.fn()
    const onAddPage = vi.fn()
    const open = () =>
      fireEvent.pointerDown(
        screen.getByRole("button", { name: "Page: Homepage" }),
        { button: 0, pointerType: "mouse" }
      )
    renderBar(true, vi.fn(), {
      sidebarCollapsed: true,
      onSelectPage,
      onAddPage,
    })
    open()
    const current = screen.getByRole("menuitemradio", { name: "Homepage" })
    expect(current.getAttribute("aria-checked")).toBe("true")
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Pricing" }))
    expect(onSelectPage).toHaveBeenCalledWith("p2")
    open()
    fireEvent.click(screen.getByRole("menuitem", { name: "New page" }))
    expect(onAddPage).toHaveBeenCalledTimes(1)
  })
})
