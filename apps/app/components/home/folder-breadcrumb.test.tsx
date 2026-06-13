// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { FolderBreadcrumb } from "./folder-breadcrumb"
import type { FolderSummary } from "@/lib/folders-actions"

// Radix's dropdown content positions itself with floating-ui (needs a
// ResizeObserver) and uses pointer-capture APIs jsdom doesn't implement.
// Polyfill the bare minimum so the overflow menu can open for assertions.
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

// Real navigable crumbs are anchors; the current crumb is a non-anchor page
// span (shadcn gives it role="link" + aria-current, so anchors are the honest
// signal of "clickable"). Map each anchor to its label + href.
function links(container: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {}
  for (const a of container.querySelectorAll("a")) {
    out[a.textContent ?? ""] = a.getAttribute("href") ?? ""
  }
  return out
}

// Render next/link as a plain anchor so the crumbs' hrefs are assertable
// without a Next router in the tree.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

afterEach(cleanup)

function folder(id: string, name: string, parentFolderId: string | null) {
  return {
    id,
    name,
    ownerId: "u1",
    parentFolderId,
    createdAt: 0,
    updatedAt: 0,
  } satisfies FolderSummary
}

describe("FolderBreadcrumb", () => {
  it("at the root shows a single non-link 'All files' crumb", () => {
    const { container } = render(<FolderBreadcrumb ancestors={[]} />)
    // The current crumb is the bold page, not a navigable link.
    expect(screen.getByText("All files").getAttribute("aria-current")).toBe(
      "page"
    )
    expect(links(container)).toEqual({})
  })

  it("at one level deep links 'All files' and bolds the current folder", () => {
    const { container } = render(
      <FolderBreadcrumb ancestors={[folder("a", "Designs", null)]} />
    )

    // "All files" is now a link back to the root; the current folder is not.
    expect(links(container)).toEqual({ "All files": "/files" })
    expect(screen.getByText("Designs").getAttribute("aria-current")).toBe(
      "page"
    )
  })

  it("renders ancestor links and the bold current crumb when nested", () => {
    const { container } = render(
      <FolderBreadcrumb
        ancestors={[
          folder("a", "Designs", null),
          folder("b", "Icons", "a"),
          folder("c", "Outlined", "b"),
        ]}
      />
    )

    // Every ancestor above the current folder links to its own level; the
    // deepest folder is the bold current page, with no link of its own.
    expect(links(container)).toEqual({
      "All files": "/files",
      Designs: "/files/a",
      Icons: "/files/b",
    })
    expect(screen.getByText("Outlined").getAttribute("aria-current")).toBe(
      "page"
    )
  })

  // A chain of `depth` folders root→current, named F0, F1, … so order is
  // assertable. Each parents the previous, mirroring a real navigation path.
  function chain(depth: number): FolderSummary[] {
    return Array.from({ length: depth }, (_, i) =>
      folder(`f${i}`, `F${i}`, i === 0 ? null : `f${i - 1}`)
    )
  }

  it("keeps the deepest still-shallow path fully inline (no overflow menu)", () => {
    const { container } = render(<FolderBreadcrumb ancestors={chain(3)} />)

    // Three ancestors is the threshold: every crumb is inline and there's no
    // ellipsis trigger to fold the middle.
    expect(links(container)).toEqual({
      "All files": "/files",
      F0: "/files/f0",
      F1: "/files/f1",
    })
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText("F2").getAttribute("aria-current")).toBe("page")
  })

  it("collapses the middle into an overflow menu once the path is deep", () => {
    const { container } = render(<FolderBreadcrumb ancestors={chain(5)} />)

    // Only "All files" (back to root) and… nothing else renders inline as a
    // link — every ancestor between it and the current folder is folded away.
    expect(links(container)).toEqual({ "All files": "/files" })
    // The current folder stays visible as the bold page crumb.
    expect(screen.getByText("F4").getAttribute("aria-current")).toBe("page")
    // The folded ancestors are not in the inline trail until the menu opens.
    expect(screen.queryByText("F1")).toBeNull()
    expect(screen.queryByText("F3")).toBeNull()
  })

  it("reveals every collapsed ancestor as a navigable link in the menu", () => {
    render(<FolderBreadcrumb ancestors={chain(5)} />)

    // Radix opens the menu from the keyboard; jsdom can drive that without the
    // pointer-capture path a real click would take.
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Show folders in between" }),
      { key: "Enter" }
    )

    // The menu lists exactly the ancestors between root and current — F0..F3 —
    // each linking to its own level, top-to-bottom in path order.
    // Each item renders `asChild` onto its `next/link` anchor, so the menuitem
    // element is itself the `<a>` carrying the destination href.
    const menu = screen.getByRole("menu")
    const items = within(menu).getAllByRole("menuitem")
    expect(
      items.map((el) => [el.textContent, el.getAttribute("href")])
    ).toEqual([
      ["F0", "/files/f0"],
      ["F1", "/files/f1"],
      ["F2", "/files/f2"],
      ["F3", "/files/f3"],
    ])
    // The current folder is not duplicated inside the menu.
    expect(within(menu).queryByText("F4")).toBeNull()
  })
})
