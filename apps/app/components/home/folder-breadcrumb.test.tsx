// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { FolderBreadcrumb } from "./folder-breadcrumb"
import type { FolderSummary } from "@/lib/folders-actions"

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
})
