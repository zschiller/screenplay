import type { Page } from "playwright-core"

import { NARROW_HOME_VIEWPORT, type Screen } from "../screen"
import {
  ids,
  homeView,
  narrowHome,
  dragOnto,
  tabTo,
  unfreeze,
} from "../helpers"

const screens: Screen[] = [
  {
    name: "home-recents",
    description: "Home → Recents: the recency-ordered grid of every Canvas.",
    path: "/",
  },
  {
    name: "home-all-files",
    description:
      "Home → All files: the Folder tree's root, Folders above Canvases.",
    path: "/files",
  },
  {
    name: "home-folder",
    description: "Inside a Folder, with the breadcrumb and a nested Folder.",
    path: `/files/${ids.folders.designSystem}`,
  },
  {
    name: "home-table-view",
    description: "The home grid switched to its table layout.",
    path: "/files",
    cookies: homeView("table"),
  },
  {
    name: "home-drop-target",
    description:
      "A Canvas dragged over a Folder tile: the drop-target ring, mid-drag.",
    path: "/files",
    prepare: async (page) => {
      await dragOnto(page, "Empty canvas", "Marketing site")
    },
    settleMs: 200,
  },
  {
    name: "home-table-drop-target",
    description:
      "The same drag in the table layout: a Folder row's drop-target ring.",
    path: "/files",
    cookies: homeView("table"),
    prepare: async (page) => {
      await dragOnto(page, "Empty canvas", "Marketing site")
    },
    settleMs: 200,
  },
  {
    name: "home-recents-narrow",
    description:
      "Recents at the narrowest content width: a small window, the sidebar dragged to its widest.",
    path: "/",
    viewport: NARROW_HOME_VIEWPORT,
    cookies: narrowHome(),
  },
  {
    name: "home-folder-narrow",
    description:
      "Two Folders deep at the narrowest content width: the breadcrumb truncates, the toolbar collapses to icons.",
    path: `/files/${ids.folders.archive}`,
    viewport: NARROW_HOME_VIEWPORT,
    cookies: narrowHome(),
  },
  {
    name: "home-table-narrow",
    description:
      "The table layout at the narrowest content width, where columns give way.",
    path: "/files",
    viewport: NARROW_HOME_VIEWPORT,
    cookies: [...narrowHome(), ...homeView("table")],
  },
  {
    name: "settings-narrow",
    description: "Settings → Coding agents at the narrowest content width.",
    path: "/settings?section=coding-agents",
    viewport: NARROW_HOME_VIEWPORT,
    cookies: narrowHome(),
    fullPage: true,
  },
  {
    name: "home-focus-tile-action",
    description:
      "Keyboard focus on a Folder tile's ⋯ actions button in the home grid.",
    path: "/files",
    prepare: async (page) => {
      await tabTo(page, "Folder actions")
    },
  },
  {
    name: "home-focus-table-action",
    description:
      "Keyboard focus on a row's ⋯ actions button in the table view.",
    path: "/files",
    cookies: homeView("table"),
    prepare: async (page) => {
      await tabTo(page, "Folder actions")
    },
  },
  {
    name: "home-narrow",
    description:
      "The home grid below the md breakpoint, where there is no hover to reveal actions.",
    path: "/files",
    viewport: { width: 720, height: 900 },
  },
  {
    name: "home-breadcrumb-overflow",
    description:
      "A deep Folder, with keyboard focus on the breadcrumb's overflow menu.",
    path: `/files/${ids.folders.drafts}`,
    prepare: async (page) => {
      await tabTo(page, "Show folders in between")
    },
  },
  {
    name: "home-resize-handle-focus",
    description:
      "Keyboard focus on the handle between the sidebar and content.",
    path: "/files",
    prepare: async (page) => {
      await page.locator("[role=separator]").first().focus()
    },
  },
  {
    name: "home-move-dialog",
    description:
      "The Move to… dialog, driven by keyboard: a destination picked with the arrow keys.",
    path: "/files",
    prepare: async (page) => {
      // The menu has to animate closed for the dialog to take over.
      await unfreeze(page)
      await tabTo(page, "Folder actions")
      await page.keyboard.press("Enter")
      // Radix focuses the first item once the menu's open animation ends.
      await page.getByRole("menu").first().waitFor({ timeout: 5_000 })
      await page.waitForTimeout(500)
      // Walk down the menu to Move to…, wherever it sits in the list.
      for (let i = 0; i < 6; i++) {
        const label = await page.evaluate(
          () => document.activeElement?.textContent?.trim() ?? ""
        )
        if (label.startsWith("Move to")) break
        await page.keyboard.press("ArrowDown")
        await page.waitForTimeout(150)
      }
      await page.keyboard.press("Enter")
      // The dialog focuses its first destination as it opens.
      await page.getByRole("radiogroup").first().waitFor({ timeout: 5_000 })
      await page.keyboard.press("ArrowDown")
    },
    settleMs: 300,
  },
  {
    name: "home-move-toast",
    description:
      "The toast after dragging a Canvas into a Folder (#808): where it went, and Undo.",
    path: "/files",
    prepare: async (page) => {
      await unfreeze(page)
      await dragOnto(page, "Empty canvas", "Marketing site")
      await page.mouse.up()
      await page.mouse.move(0, 0)
      await page.waitForTimeout(1000)
    },
    settleMs: 300,
  },
  {
    name: "home-breadcrumb-drop-target",
    description:
      "A Canvas dragged over a parent Folder's breadcrumb (#808), mid-drag.",
    path: `/files/${ids.folders.archive}`,
    prepare: async (page) => {
      await dragOntoCrumb(page, "Old experiment", "Design system")
    },
    settleMs: 200,
  },
  {
    name: "home-move-dialog-new-folder",
    description:
      "The Move to… dialog naming a new Folder inside the picked destination (#808).",
    path: "/files",
    prepare: async (page) => {
      await unfreeze(page)
      await page
        .getByRole("button", { name: "Folder actions" })
        .first()
        .click({ timeout: 15_000 })
      await page.getByRole("menuitem", { name: /^Move to/ }).click()
      await page.getByRole("radiogroup").first().waitFor({ timeout: 5_000 })
      await page.getByRole("radio", { name: "Marketing site" }).click()
      await page.getByRole("button", { name: "New folder" }).click()
      await page.keyboard.type("Launch week")
      await page.waitForTimeout(300)
    },
    settleMs: 300,
  },
  {
    name: "home-search",
    description:
      "Home search (#807): a popover of results from every folder, each naming where it lives.",
    path: "/files",
    prepare: async (page) => {
      await searchHome(page, "design")
    },
  },
  {
    name: "home-search-empty",
    description: "A search that matches nothing: the popover says so.",
    path: "/files",
    prepare: async (page) => {
      await searchHome(page, "zzz")
    },
  },
  {
    name: "home-search-narrow",
    description:
      "Search at the narrowest content width, over the table layout.",
    path: "/files",
    viewport: NARROW_HOME_VIEWPORT,
    cookies: [...narrowHome(), ...homeView("table")],
    prepare: async (page) => {
      await searchHome(page, "exp")
    },
  },
]

export default screens

/**
 * Pick up the tile or row named `source` and hold it over the breadcrumb crumb
 * named `crumb`, without letting go, so the shot catches the crumb's drop
 * highlight. Same pointer choreography as {@link dragOnto}.
 */
async function dragOntoCrumb(
  page: Page,
  source: string,
  crumb: string
): Promise<void> {
  const from = await page
    .getByText(source, { exact: true })
    .first()
    .locator("xpath=ancestor-or-self::*[@aria-roledescription='draggable'][1]")
    .boundingBox({ timeout: 15_000 })
  const to = await page
    .locator('[data-slot="breadcrumb-item"]', { hasText: crumb })
    .first()
    .boundingBox({ timeout: 15_000 })
  if (!from || !to) throw new Error(`drag: ${source} or ${crumb} not on screen`)
  // Grab by the top-left corner so the preview hangs below and right of the
  // pointer, and hover the crumb's bottom-right corner, so the preview leaves
  // the crumb and its ring in view.
  const grab = { x: from.x + 3, y: from.y + 3 }
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x, grab.y + 12)
  await page.mouse.move(to.x + to.width - 4, to.y + to.height - 4, {
    steps: 12,
  })
}

/**
 * Focus home search with its `/` shortcut and type a query. The first key can
 * land before hydration wires the shortcut, so retry until the field has focus.
 */
async function searchHome(page: Page, query: string): Promise<void> {
  const field = page.getByLabel("Search canvases and folders")
  await field.waitFor({ timeout: 15_000 })
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.keyboard.press("/")
    if (await field.evaluate((el) => el === document.activeElement)) break
    await page.waitForTimeout(250)
  }
  await page.keyboard.type(query)
}
