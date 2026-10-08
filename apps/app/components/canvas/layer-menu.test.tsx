// @vitest-environment jsdom
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  LayerMenu,
  LayerMenuContent,
  LayerMenuProvider,
  useRegisterLayerMenu,
  type LayerMenuActions,
} from "./layer-menu"
import { MoveToPageContext, type MoveToPage } from "./move-to-page"
import { ViewingProvider } from "@/lib/viewer/context"

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
  fitToContent: { checked: false, onCheckedChange: vi.fn() },
  chat: { branchId: "branch-1", onPlay: vi.fn() },
  onDelete: vi.fn(),
  ...overrides,
})

/** The open menu's items, in order, as their visible text. */
function items() {
  return [
    ...document.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"]'),
  ].map((item) => item.textContent?.replace(/⌘D$/, " ⌘D"))
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
      "Preview",
      "Delete",
    ])
  })

  it("shows Fit to content as a toggle", () => {
    const onCheckedChange = vi.fn()
    openMenu({
      actions: frame({ fitToContent: { checked: true, onCheckedChange } }),
    })
    const item = screen.getByRole("menuitemcheckbox", {
      name: "Fit to content",
    })
    expect(item.getAttribute("aria-checked")).toBe("true")
    fireEvent.click(item)
    expect(onCheckedChange).toHaveBeenCalledWith(false)
  })

  it("gives a document and a Group Rename and Delete", () => {
    openMenu({
      actions: { noun: "document", onDelete: vi.fn() },
      onRename: vi.fn(),
    })
    expect(items()).toEqual(["Rename", "Delete"])
  })

  it("gives a Document's or Mockup's view Remove from canvas and Delete file (#1884)", () => {
    const onDelete = vi.fn()
    const onDeleteFile = vi.fn()
    const onDuplicateAsNewFile = vi.fn()
    openMenu({
      actions: {
        noun: "mockup",
        onDuplicate: vi.fn(),
        onDuplicateAsNewFile,
        onDelete,
        onDeleteFile,
      },
      onRename: vi.fn(),
    })
    expect(items()).toEqual([
      "Rename",
      "Duplicate ⌘D",
      "Duplicate as new file",
      "Remove from canvas",
      "Delete file",
    ])
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete file" }))
    expect(onDeleteFile).toHaveBeenCalledTimes(1)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it("shows no Delete, and no separator before it, without a removal", () => {
    openMenu({
      actions: { noun: "mockup", onDuplicate: vi.fn() },
      onRename: vi.fn(),
    })
    expect(items()).toEqual(["Rename", "Duplicate ⌘D"])
    expect(screen.queryAllByRole("separator")).toEqual([])
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

/** Press a trigger the way Radix's dropdown opens on. */
function press(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" })
}

describe("LayerMenu", () => {
  const nouns = ["frame", "mockup", "document", "group"] as const
  const names = {
    frame: "Frame options",
    mockup: "Mockup options",
    document: "Document options",
    group: "Group options",
  }

  it.each(nouns)("names every %s trigger after the object", (noun) => {
    render(
      <LayerMenuProvider>
        <LayerMenu placement="toolbar" actions={{ noun }} />
        <LayerMenu placement="label" actions={{ noun }} />
        <LayerMenu placement="row" layerId="layer-1" actions={{ noun }} />
      </LayerMenuProvider>
    )
    expect(screen.getAllByRole("button", { name: names[noun] })).toHaveLength(3)
    expect(screen.queryByRole("button", { name: "More" })).toBeNull()
  })

  it("gives a viewer no menu at all (#1933)", () => {
    render(
      <ViewingProvider
        value={{
          person: { id: "ana", name: "Ana" },
          roomId: "room-1",
          shareKey: "key",
        }}
      >
        <LayerMenuProvider>
          <LayerMenu placement="toolbar" actions={frame()} />
          <LayerMenu placement="label" actions={frame()} />
          <LayerMenu placement="row" layerId="layer-1" actions={frame()} />
        </LayerMenuProvider>
      </ViewingProvider>
    )
    expect(screen.queryByRole("button", { name: "Frame options" })).toBeNull()
  })

  it("opens the object's menu from the toolbar", () => {
    render(<LayerMenu placement="toolbar" actions={frame()} />)
    press(screen.getByRole("button", { name: "Frame options" }))
    expect(items()).toEqual([
      "Duplicate ⌘D",
      "Device size",
      "Fit to content",
      "Preview",
      "Delete",
    ])
  })

  /** A Canvas list of three rows of one kind, the middle one a Group header
   *  with a member when `noun` is "group". */
  function Rows({ noun }: { noun: (typeof nouns)[number] }) {
    const [ids, setIds] = useState(["a", "b", "c"])
    const row = (id: string) => (
      <>
        <button data-sidebar="menu-button">{`Row ${id}`}</button>
        <LayerMenu
          placement="row"
          layerId={id}
          actions={{
            noun,
            onDelete: () => setIds((all) => all.filter((x) => x !== id)),
          }}
        />
      </>
    )
    return (
      <LayerMenuProvider>
        {ids.map((id) =>
          noun === "group" && id === "b" ? (
            <div key={id} data-sidebar="menu-item">
              <div data-sidebar-row="group">{row(id)}</div>
              <div data-sidebar-row="row">
                <button data-sidebar="menu-sub-button">Member</button>
              </div>
            </div>
          ) : (
            <div key={id} data-sidebar-row="row">
              {row(id)}
            </div>
          )
        )}
      </LayerMenuProvider>
    )
  }

  it.each(nouns)(
    "moves focus to the next row when a %s row's menu deletes it",
    async (noun) => {
      render(<Rows noun={noun} />)
      const triggers = screen.getAllByRole("button", { name: names[noun] })
      act(() => triggers[1]!.focus())
      press(triggers[1]!)
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))
      expect(screen.queryByText("Row b")).toBeNull()
      // The menu's close moves focus once it has unmounted.
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByText("Row c"))
      )
    }
  )
})

describe("Move to page (#1837)", () => {
  const pages = [
    { id: "p1", name: "Site", order: 0 },
    { id: "p2", name: "Explorations", order: 1 },
    { id: "p3", name: "Archive", order: 2 },
  ]

  function renderMenu(context: MoveToPage | null) {
    render(
      <MoveToPageContext.Provider value={context}>
        <LayerMenu
          placement="toolbar"
          actions={frame({ moveTo: { kind: "layer", id: "frame-1" } })}
        />
      </MoveToPageContext.Provider>
    )
    press(screen.getByRole("button", { name: "Frame options" }))
  }

  it("follows Duplicate and lists every other page", async () => {
    const move = vi.fn()
    renderMenu({ pages, currentPageId: "p1", move })
    expect(items().slice(0, 2)).toEqual(["Duplicate ⌘D", "Move to page"])

    const trigger = screen.getByRole("menuitem", { name: "Move to page" })
    fireEvent.keyDown(trigger, { key: "ArrowRight" })
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Archive" })).toBeTruthy()
    )
    expect(screen.queryByRole("menuitem", { name: "Site" })).toBeNull()
    fireEvent.click(screen.getByRole("menuitem", { name: "Explorations" }))
    expect(move).toHaveBeenCalledWith({ kind: "layer", id: "frame-1" }, "p2")
  })

  it("is left out on a one-page canvas", () => {
    renderMenu({ pages: pages.slice(0, 1), currentPageId: "p1", move: vi.fn() })
    expect(items()).not.toContain("Move to page")
  })
})
