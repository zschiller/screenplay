// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { SidebarProvider } from "@workspace/ui/components/sidebar"
import { TooltipProvider } from "@workspace/ui/components/tooltip"

import { PagesSection } from "./pages-section"
import type { PageData } from "@/lib/types"

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

function renderSection(
  overrides: Partial<React.ComponentProps<typeof PagesSection>> = {}
) {
  const props = {
    pages: PAGES,
    currentPageId: "page-1",
    onSelectPage: vi.fn(),
    onAddPage: vi.fn(() => "p2"),
    onRenamePage: vi.fn(),
    ...overrides,
  }
  render(
    <TooltipProvider>
      <SidebarProvider>
        <PagesSection {...props} />
      </SidebarProvider>
    </TooltipProvider>
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
