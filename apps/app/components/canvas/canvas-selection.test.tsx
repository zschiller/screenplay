// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createRef } from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { CanvasTopBar } from "./canvas-top-bar"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("@/lib/rooms-actions", () => ({ deleteRoom: vi.fn() }))

afterEach(cleanup)

beforeAll(() => {
  const style = document.createElement("style")
  style.textContent = readFileSync(
    join(import.meta.dirname, "canvas-selection.css"),
    "utf8"
  )
  document.head.append(style)
})

/**
 * The browser's used `user-select`: `auto` takes its parent's value, so the
 * nearest element that sets one decides. jsdom only computes each element's
 * own declared value, so the walk up is done here.
 */
function userSelect(el: Element): string {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const value = getComputedStyle(node).userSelect
    if (value && value !== "auto") return value
  }
  return "text"
}

function renderCanvas() {
  render(
    <div data-canvas-wrapper>
      <CanvasTopBar
        roomId="r1"
        isOwner
        sharedWithCount={1}
        parentFolder={null}
        currentRoomName="Checkout flow"
        onRoomRename={vi.fn()}
        sidebarCollapsed={false}
        trafficLightsPresent={false}
        sidebarPanelRef={createRef()}
        roomNameEditableRef={createRef()}
        pendingRoomRenameRef={{ current: false }}
        onRoomMenuCloseAutoFocus={vi.fn()}
        deleteDialogOpen={false}
        onDeleteDialogOpenChange={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenShortcuts={vi.fn()}
        stopRoomDevServers={vi.fn()}
        flushLayout={() => Promise.resolve()}
        pages={[{ id: "page-1", name: "Page 1", order: 0 }]}
        currentPageId="page-1"
        onSelectPage={vi.fn()}
        onAddPage={vi.fn()}
      />
      <span>Checkout · desktop</span>
      {/* A Document in edit mode, as Tiptap renders it. */}
      <div className="tiptap" contentEditable suppressContentEditableWarning>
        <p>Document body</p>
      </div>
      <div data-selectable-text>
        <p>Comment body</p>
      </div>
    </div>
  )
}

describe("text selection on the canvas", () => {
  it("leaves canvas chrome unselectable, so a stray drag highlights nothing", () => {
    renderCanvas()
    expect(userSelect(screen.getByText("Checkout flow"))).toBe("none")
    expect(userSelect(screen.getByText("Checkout · desktop"))).toBe("none")
  })

  it("keeps rename fields, document text and comments selectable", () => {
    renderCanvas()
    fireEvent.pointerDown(screen.getByText("Checkout flow"), { button: 0 })
    fireEvent.pointerDown(screen.getByText("Checkout flow"), { button: 0 })
    expect(userSelect(screen.getByRole("textbox"))).toBe("text")
    expect(userSelect(screen.getByText("Document body"))).toBe("text")
    expect(userSelect(screen.getByText("Comment body"))).toBe("text")
  })
})
