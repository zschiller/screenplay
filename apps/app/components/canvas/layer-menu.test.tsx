// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  LayerMenuContent,
  LayerMenuProvider,
  useRegisterLayerMenu,
  type LayerMenuActions,
} from "./layer-menu"

// Radix's dropdown content positions itself with floating-ui, which needs a
// ResizeObserver, and uses pointer-capture APIs jsdom doesn't implement.
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

const frame = (
  overrides: Partial<LayerMenuActions> = {}
): LayerMenuActions => ({
  noun: "frame",
  onDuplicate: vi.fn(),
  size: { width: 390, height: 844, onSelect: vi.fn() },
  onFitToContent: vi.fn(),
  chat: { branchId: "branch-1", onPlay: vi.fn() },
  onDelete: vi.fn(),
  ...overrides,
})

/** The open menu's items, in order, as their visible text. */
function items() {
  return screen
    .getAllByRole("menuitem")
    .map((item) => item.textContent?.replace(/⌘D$/, " ⌘D"))
}

function openMenu(
  props: Omit<Parameters<typeof LayerMenuContent>[0], "side" | "align">
) {
  return render(
    <DropdownMenu open>
      <DropdownMenuTrigger>open</DropdownMenuTrigger>
      <LayerMenuContent {...props} />
    </DropdownMenu>
  )
}

describe("LayerMenuContent", () => {
  it("lists a frame's items in one order: name, layout, chat, delete", () => {
    openMenu({ actions: frame(), onRename: vi.fn() })
    expect(items()).toEqual([
      "Rename",
      "Duplicate ⌘D",
      "Device size",
      "Fit to content",
      "Chat",
      "Delete",
    ])
  })

  it("gives a document and a Group Rename and Delete", () => {
    openMenu({
      actions: { noun: "document", onDelete: vi.fn() },
      onRename: vi.fn(),
    })
    expect(items()).toEqual(["Rename", "Delete"])
  })

  it("Delete calls the object's removal", () => {
    const onDelete = vi.fn()
    openMenu({ actions: { noun: "group", onDelete }, onRename: vi.fn() })
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})

describe("a sidebar row's menu", () => {
  function Frame({ actions }: { actions: LayerMenuActions }) {
    useRegisterLayerMenu("frame-1", actions)
    return null
  }

  it("opens the menu its canvas Layer published", () => {
    render(
      <LayerMenuProvider>
        <Frame actions={frame()} />
        <DropdownMenu open>
          <DropdownMenuTrigger>open</DropdownMenuTrigger>
          <LayerMenuContent
            layerId="frame-1"
            actions={{ noun: "frame", onDelete: vi.fn() }}
            onRename={vi.fn()}
          />
        </DropdownMenu>
      </LayerMenuProvider>
    )
    expect(items()).toContain("Duplicate ⌘D")
    expect(items()).toContain("Fit to content")
  })

  it("falls back to Rename and Delete while its Layer isn't mounted", () => {
    render(
      <LayerMenuProvider>
        <DropdownMenu open>
          <DropdownMenuTrigger>open</DropdownMenuTrigger>
          <LayerMenuContent
            layerId="frame-1"
            actions={{ noun: "frame", onDelete: vi.fn() }}
            onRename={vi.fn()}
          />
        </DropdownMenu>
      </LayerMenuProvider>
    )
    expect(items()).toEqual(["Rename", "Delete"])
  })
})
