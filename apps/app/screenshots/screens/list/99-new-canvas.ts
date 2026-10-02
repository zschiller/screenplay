import type { Screen } from "../screen"
import { isHomePath, unfreeze, showTooltip } from "../helpers"

const screens: Screen[] = [
  // --- New canvas (issue #777) ---------------------------------------------
  // Last in the list on purpose: `home-new-canvas` really creates a Canvas, so
  // anything shot after it on the same server would show an extra tile.
  {
    name: "home-new-canvas-hint",
    description: "Hovering the header's New canvas button.",
    path: "/",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "New canvas" })
        .first()
        .hover({ timeout: 15_000 })
      await showTooltip(page)
    },
  },
  {
    name: "home-folder-menu",
    description: "A pinned folder's actions menu in the home sidebar.",
    path: "/",
    prepare: async (page) => {
      await unfreeze(page)
      const row = page
        .locator('[data-sidebar="menu-item"]')
        .filter({ hasText: "Design system" })
        .first()
      await row.hover({ timeout: 15_000 })
      await row.getByRole("button", { name: "Folder actions" }).click()
      await page.getByRole("menu").first().waitFor({ timeout: 5_000 })
      await page.waitForTimeout(300)
    },
    settleMs: 300,
  },
  {
    name: "home-new-canvas",
    description:
      "What pressing New canvas on home opens: the new Untitled Canvas itself.",
    path: "/",
    prepare: async (page) => {
      await unfreeze(page)
      // The header button can be clicked before hydration wires it up, so
      // retry until something happens (a dialog, or the Canvas route).
      const dialog = page.getByRole("dialog")
      for (let i = 0; i < 5; i++) {
        if ((await dialog.count()) || !isHomePath(page.url())) break
        await page.getByRole("button", { name: "New canvas" }).first().click()
        await page.waitForTimeout(800)
      }
      if (!(await dialog.count())) {
        await page
          .getByText("This canvas is empty")
          .waitFor({ timeout: 30_000 })
          .catch(() => {})
      }
      await page.waitForTimeout(1000)
    },
    settleMs: 300,
  },
]

export default screens
