import type { Page } from "playwright-core"

import { DEFAULT_VIEWPORT, type Screen } from "../screen"
import { ids } from "../helpers"

const screens: Screen[] = [
  {
    name: "canvas-document-type",
    // After every other Design tokens screen on purpose: the zoom persists
    // into the Canvas's saved viewport.
    description:
      "Two Documents zoomed in to read their type: serif headings, lists and inline code (#1048).",
    path: `/${ids.rooms.tokens}`,
    prepare: async (page) => {
      // Double-clicking the Group's sidebar row zooms the Canvas to both
      // Documents; Escape and a blur drop the selection and focus rings.
      await page
        .locator('[data-sidebar="menu-button"]')
        .filter({ hasText: /^Tokens$/ })
        .first()
        .dblclick({ timeout: 15_000 })
      await page.waitForTimeout(800)
      await page.keyboard.press("Escape")
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
      await page.mouse.move(4, 600)
    },
    settleMs: 400,
  },
  {
    name: "canvas-zoomed-out",
    // After every other Canvas screen on purpose: the zoom persists into the
    // Canvas's saved viewport, so any Canvas screen after this one would open
    // at 10%. Only the home New canvas screens below may follow it.
    description:
      "The Canvas zoomed all the way out with a frame selected: Layer labels and resize handles at minimum zoom.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page
        .getByText("Checkout · desktop", { exact: true })
        .first()
        .click({ timeout: 15_000 })
      await zoomOutFully(page)
    },
    settleMs: 400,
  },
]

export default screens

/**
 * Wait for the hovered control's tooltip and show it at rest.
 *
 * The runner freezes animations before `prepare` runs, which would pin a
 * tooltip on the first frame of its fade-in — i.e. invisible. Dropping the
 * animation on tooltip content alone lets it paint in its final state.
 */
/**
 * Ctrl+wheel the Canvas out to its minimum zoom, centered on the viewport, then
 * wait out the camera's settle so the overlays come back.
 */
async function zoomOutFully(page: Page): Promise<void> {
  const box = page.viewportSize() ?? DEFAULT_VIEWPORT
  await page.mouse.move(box.width / 2, box.height / 2)
  await page.keyboard.down("Control")
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(30)
  }
  await page.keyboard.up("Control")
  await page.mouse.move(box.width - 40, box.height / 2)
  await page.waitForTimeout(500)
}
