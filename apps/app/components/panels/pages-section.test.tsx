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
import * as Y from "yjs"
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness"
import { SidebarProvider } from "@workspace/ui/components/sidebar"
import { TooltipProvider } from "@workspace/ui/components/tooltip"

import { PagesSection } from "./pages-section"
import type { PageData } from "@/lib/types"
import { YjsConnectionProvider } from "@/lib/yjs/context"
import type { CanvasPresence } from "@/lib/yjs/react"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// The sidebar reads the viewport width.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

afterEach(cleanup)

const PAGES: PageData[] = [
  { id: "page-1", name: "Homepage", order: 0 },
  { id: "p2", name: "Pricing", order: 1 },
]

let awareness = new Awareness(new Y.Doc())

/** The page rows, apart from the heading, which also names the current page. */
const pageList = () => within(screen.getByRole("list", { name: "Pages" }))

function renderSection(
  overrides: Partial<React.ComponentProps<typeof PagesSection>> = {}
) {
  awareness = new Awareness(new Y.Doc())
  const props = {
    pages: PAGES,
    currentPageId: "page-1",
    onSelectPage: vi.fn(),
    onAddPage: vi.fn(() => "p2"),
    onRenamePage: vi.fn(),
    open: true,
    onOpenChange: vi.fn(),
    onReorderPages: vi.fn(),
    onDuplicatePage: vi.fn(),
    onDeletePage: vi.fn(),
    ...overrides,
  }
  render(
    <YjsConnectionProvider
      value={{ doc: awareness.doc, awareness, roomId: "room" }}
    >
      <TooltipProvider>
        <SidebarProvider>
          <PagesSection {...props} />
        </SidebarProvider>
      </TooltipProvider>
    </YjsConnectionProvider>
  )
  return props
}

describe("PagesSection (#1835, #1836)", () => {
  it("lists every page and marks the current one", () => {
    renderSection()
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent)
    expect(rows).toEqual(["Homepage", "Pricing"])
    expect(
      pageList()
        .getByText("Homepage")
        .closest("button")
        ?.getAttribute("aria-current")
    ).toBe("page")
    expect(
      pageList()
        .getByText("Pricing")
        .closest("button")
        ?.hasAttribute("aria-current")
    ).toBe(false)
  })

  it("switches page on click", () => {
    const props = renderSection()
    fireEvent.click(pageList().getByText("Pricing"))
    expect(props.onSelectPage).toHaveBeenCalledWith("p2")
  })

  it("+ adds a page and opens its name for renaming; Enter commits", () => {
    const props = renderSection()
    fireEvent.click(screen.getByRole("button", { name: "New page" }))
    expect(props.onAddPage).toHaveBeenCalled()

    const field = document.querySelector("[data-editable-text=editing]")
    expect(field?.textContent).toBe("Pricing")
    field!.textContent = "Explorations"
    fireEvent.input(field!)
    fireEvent.keyDown(field!, { key: "Enter" })
    expect(props.onRenamePage).toHaveBeenCalledWith("p2", "Explorations")
  })

  function openMenu(row: string) {
    const item = within(screen.getByRole("list")).getByText(row).closest("li")!
    fireEvent.pointerDown(
      within(item).getByRole("button", { name: "Page options" }),
      { button: 0, ctrlKey: false }
    )
    return screen.getByRole("menu")
  }

  it("a page’s ⋯ menu duplicates and deletes", () => {
    const props = renderSection()
    const menu = openMenu("Pricing")
    expect(
      [...menu.querySelectorAll("[role=menuitem]")].map((i) => i.textContent)
    ).toEqual(["Rename", "Duplicate", "Delete"])

    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }))
    expect(props.onDuplicatePage).toHaveBeenCalledWith("p2")
    openMenu("Pricing")
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))
    expect(props.onDeletePage).toHaveBeenCalledWith("p2")
  })

  it("does nothing special on right-click", () => {
    renderSection()
    const item = within(screen.getByRole("list"))
      .getByText("Pricing")
      .closest("li")!
    expect(fireEvent.contextMenu(item)).toBe(true)
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("turns Delete off on the last page", () => {
    const props = renderSection({ pages: [PAGES[0]!] })
    openMenu("Homepage")
    const remove = screen.getByRole("menuitem", { name: "Delete" })
    expect(remove.getAttribute("aria-disabled")).toBe("true")
    fireEvent.click(remove)
    expect(props.onDeletePage).not.toHaveBeenCalled()
  })
})

/** Another person in the canvas, on `pageId` (none: a client from before
 *  pages). */
function join(name: string, pageId?: string) {
  const peer = new Awareness(new Y.Doc())
  const state: CanvasPresence = {
    identity: { id: name, name },
    pointer: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    color: "#ff6ec7",
    selectedIframeLayerIds: [],
    ...(pageId ? { pageId } : {}),
  }
  peer.setLocalState(state)
  act(() =>
    applyAwarenessUpdate(
      awareness,
      encodeAwarenessUpdate(peer, [peer.clientID]),
      "remote"
    )
  )
  return peer
}

const peopleOn = (name: string) =>
  pageList()
    .getByText(name)
    .closest("button")
    ?.querySelector("[role=img]")
    ?.getAttribute("aria-label") ?? null

describe("PagesSection people (#1840)", () => {
  it("shows the other people on each page on its row", () => {
    renderSection()
    expect(peopleOn("Homepage")).toBeNull()
    join("Maya", "p2")
    join("Ben", "p2")
    join("Ada")
    expect(peopleOn("Pricing")).toBe("Maya, Ben")
    // No page (an older client) or a page that's gone: the first page.
    expect(peopleOn("Homepage")).toBe("Ada")
    join("Cy", "deleted")
    expect(peopleOn("Homepage")).toBe("Ada, Cy")
  })

  it("moves a person's avatar when they change page", () => {
    renderSection()
    const maya = join("Maya", "p2")
    expect(peopleOn("Pricing")).toBe("Maya")
    maya.setLocalState({ ...maya.getLocalState()!, pageId: "page-1" })
    act(() =>
      applyAwarenessUpdate(
        awareness,
        encodeAwarenessUpdate(maya, [maya.clientID]),
        "remote"
      )
    )
    expect(peopleOn("Pricing")).toBeNull()
    expect(peopleOn("Homepage")).toBe("Maya")
  })
})

describe("PagesSection folding", () => {
  const heading = () => screen.getByRole("button", { expanded: true })

  it("folds and unfolds from its heading", () => {
    const props = renderSection()
    fireEvent.click(heading())
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("names the current page in the heading once folded", () => {
    renderSection({ open: false, currentPageId: "p2" })
    const toggle = screen
      .getAllByRole("button", { expanded: false })
      .find((el) => el.dataset.sidebar === "group-label")!
    expect(toggle.getAttribute("aria-controls")).toBe(
      screen.getByRole("list", { hidden: true }).id
    )
    expect(
      within(toggle)
        .getAllByText(/./)
        .find((el) => el.getAttribute("aria-hidden") === "false")?.textContent
    ).toBe("Pricing")
    // The rows are out of reach while folded.
    expect(
      screen.getByRole("list", { hidden: true }).hasAttribute("inert")
    ).toBe(true)
  })

  it("unfolds when a page is added while folded", () => {
    const props = renderSection({ open: false })
    fireEvent.click(screen.getByRole("button", { name: "New page" }))
    expect(props.onOpenChange).toHaveBeenCalledWith(true)
    expect(props.onAddPage).toHaveBeenCalled()
  })
})
