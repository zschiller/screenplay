import type { Page } from "playwright-core"

import type { Screen } from "../screen"
import {
  canvasPanels,
  ids,
  checkoutDesktopFrame,
  openChatsMenu,
  workspaceMenuRow,
  showTooltip,
} from "../helpers"

const screens: Screen[] = [
  {
    name: "sidebar-layer-menu-hover",
    description: "Hovering a Layer row's overflow (…) button in the sidebar.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      const row = page.locator(".group\\/frame-row").first()
      await row.hover()
      await row
        .locator('[aria-haspopup="menu"]')
        .first()
        .hover({ timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "sidebar-rename-frame",
    description:
      "Renaming a frame in the layer list, mid-typing: spaces reach the field and it takes the theme's colours.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      // A rename started before the Canvas settles loses focus to it.
      await checkoutDesktopFrame(page).waitFor({ timeout: 15_000 })
      await page.waitForTimeout(500)
      await page
        .locator(".group\\/frame-row [data-editable-text=idle]")
        .first()
        .dblclick({ timeout: 15_000 })
      await page
        .locator("[data-editable-text=editing]")
        .waitFor({ timeout: 5_000 })
      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.type("Cart with coupon")
    },
    settleMs: 300,
  },
  {
    name: "canvas-rename-group",
    description:
      "Renaming a Group from its label on the Canvas, mid-typing: the field takes the theme's colours.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page
        // The Canvas label is the one that doubles as a drag handle.
        .locator("[data-editable-text=idle].cursor-grab")
        .filter({ hasText: /^Cart$/ })
        .first()
        .dblclick({ timeout: 15_000 })
      await page
        .locator("[data-editable-text=editing]")
        .waitFor({ timeout: 5_000 })
      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.type("Cart and checkout")
    },
    settleMs: 300,
  },
  {
    name: "workspaces-menu-hover-frames",
    description:
      "Hovering a Workspace row: its frames are outlined on the Canvas and lit in the layer list (#793).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await hoverWorkspaceRow(page, "Checkout polish")
    },
    settleMs: 300,
  },
  {
    name: "sidebar-frame-row-hover-workspace",
    description:
      "Hovering a frame row in the layer list: its Workspace row lights up in the open Chats menu (#793).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatsMenu(page)
      await page
        .locator(".group\\/frame-row")
        .filter({ hasText: "Empty cart" })
        .first()
        .hover({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "canvas-frame-hover-workspace",
    description:
      "Hovering a frame on the Canvas: its Workspace row lights up in the open Chats menu (#793).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatsMenu(page)
      const frame = checkoutDesktopFrame(page)
      await frame.waitFor({ state: "visible", timeout: 15_000 })
      await frame.hover({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "workspaces-menu-hover-groups",
    description:
      "Hovering a Workspace row lights up the Groups whose frames all show it, and those frames (#872, #1276).",
    path: `/${ids.rooms.pricing}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await hoverWorkspaceRow(page, "Pricing tiers")
    },
    settleMs: 300,
  },
  {
    name: "workspaces-menu-hover-exception",
    description:
      "Hovering the Workspace of one frame in a Group of mixed Workspaces: that frame lights up, its Group doesn't (#872).",
    path: `/${ids.rooms.frameStates}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await hoverWorkspaceRow(page, "saved-searches")
    },
    settleMs: 300,
  },
  {
    name: "sidebar-group-row-hover-workspace",
    description:
      "Hovering a Group row in the layer list: its Workspace row lights up in the open Chats menu (#872).",
    path: `/${ids.rooms.pricing}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatsMenu(page)
      await page
        .locator(".group\\/frame-group-row")
        .filter({ hasText: "Pricing" })
        .first()
        .hover({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "canvas-group-pill-hover-workspace",
    description:
      "Hovering the Workspace pill on a Group's label on the Canvas: its Workspace row lights up (#872).",
    path: `/${ids.rooms.pricing}`,
    prepare: async (page) => {
      await page
        .locator('[data-slot="group-workspace"]')
        .first()
        .hover({ timeout: 15_000 })
    },
    settleMs: 300,
  },
]

export default screens

/** Hover a Workspace row in the Chats menu by its branch (or title). */
async function hoverWorkspaceRow(page: Page, name: string): Promise<void> {
  const row = await workspaceMenuRow(page, name)
  await row.hover({ timeout: 15_000 })
}
