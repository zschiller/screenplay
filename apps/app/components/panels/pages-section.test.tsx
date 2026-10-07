// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
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

describe("PagesSection (#1835)", () => {
  it("lists every page and marks the current one", () => {
    renderSection()
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent)
    expect(rows).toEqual(["Homepage", "Pricing"])
    expect(
      screen
        .getByText("Homepage")
        .closest("button")
        ?.getAttribute("aria-current")
    ).toBe("page")
    expect(
      screen
        .getByText("Pricing")
        .closest("button")
        ?.hasAttribute("aria-current")
    ).toBe(false)
  })

  it("switches page on click", () => {
    const props = renderSection()
    fireEvent.click(screen.getByText("Pricing"))
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
  screen
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
