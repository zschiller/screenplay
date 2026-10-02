import type { Page } from "playwright-core"

import type { Screen } from "../screen"
import {
  canvasPanels,
  ids,
  selectWorkspace,
  openChatsMenu,
  waitForWorkspaceHoverCard,
  selectCheckoutFrame,
} from "../helpers"

const screens: Screen[] = [
  {
    name: "canvas-setup-error",
    description:
      "A Workspace's setup error opened from the sidebar, as a keyboard user reaches it.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openSetupError(page)
    },
    settleMs: 300,
  },
  {
    name: "canvas-workspace-status",
    description:
      "Hovering a Workspace row that's still setting up: its hover card names the step (#882).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      const menu = await openChatsMenu(page)
      await menu
        .getByRole("img", { name: "Running setup script" })
        .hover({ timeout: 15_000 })
      await waitForWorkspaceHoverCard(page)
    },
    settleMs: 300,
  },
  {
    name: "canvas-workspace-hover-card",
    description:
      "Hovering a Workspace's name in its chat header: title, status, repository, git branch, base and changes (#882).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await selectWorkspace(page, "Checkout polish")
      await page
        .locator("[data-slot=tabs]")
        .locator("[data-slot=workspace-mention]")
        .first()
        .hover({ timeout: 15_000 })
      await waitForWorkspaceHoverCard(page)
    },
    settleMs: 300,
  },
  {
    name: "canvas-workspace-hover-card-plan",
    description:
      "Hovering the chat header of a Workspace whose plan waits: the orange needs-you dot and Plan waiting for approval.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await selectWorkspace(page, "Empty cart state")
      await page
        .locator("[data-slot=tabs]")
        .locator("[data-slot=workspace-mention]")
        .first()
        .hover({ timeout: 15_000 })
      await waitForWorkspaceHoverCard(page)
    },
    settleMs: 300,
  },
  {
    name: "canvas-workspace-hover-card-group",
    description:
      "Hovering a group label's Workspace pill: the same hover card as the row (#882).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page
        // The Cart group label's pill, not the sidebar group row's. The
        // Checkout group's label sits under the top chrome at this viewport.
        .locator("[data-slot=badge]:not([data-slot=sidebar-menu-button] *)", {
          hasText: "Empty cart state",
        })
        .first()
        .hover({ timeout: 15_000 })
      await waitForWorkspaceHoverCard(page)
    },
    settleMs: 300,
  },
  {
    name: "canvas-workspace-hover-card-pill",
    description:
      "Hovering the Workspace in a selected frame's address bar: the same hover card as the row (#882).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await selectCheckoutFrame(page)
      await page
        .getByRole("button", { name: /^Workspace: / })
        .first()
        .hover({ timeout: 15_000 })
      await waitForWorkspaceHoverCard(page)
    },
    settleMs: 300,
  },
  {
    name: "canvas-workspaces-two-repos",
    description:
      "The Chats menu on a canvas with two repositories: each row ends with its repository (#884, #1152).",
    path: `/${ids.rooms.pricing}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatsMenu(page)
      await page.mouse.move(900, 900)
    },
    settleMs: 400,
  },
  {
    name: "canvas-pr-merged",
    description:
      "A Canvas whose Workspace has a merged PR and an agent turn in flight: the activity spinner up front, the merged PR at the row's end (#963).",
    path: `/${ids.rooms.pricing}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatsMenu(page)
      await page.mouse.move(900, 900)
    },
    settleMs: 400,
  },
  {
    name: "canvas-pr-closed",
    description:
      "A Canvas with a stopped Workspace (a dashed circle, its closed PR not shown) and one still being created.",
    path: `/${ids.rooms.onboarding}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatsMenu(page)
      await page.mouse.move(900, 900)
    },
    settleMs: 400,
  },
]

export default screens

/**
 * Open the failed Workspace's setup error from the Chats menu. Where the indicator
 * is a button, it is reached the way a keyboard user would — focus, then Enter —
 * so the shot proves the error is readable without a mouse. On builds where it
 * is still a bare icon (a hover card), fall back to hovering it, which is the
 * only way that version can be opened.
 */
async function openSetupError(page: Page): Promise<void> {
  // The failed Workspace's status icon is labelled by what failed; it opens
  // the error card.
  const menu = await openChatsMenu(page)
  const button = menu.getByRole("button", { name: /failed$/ })
  await button.first().focus({ timeout: 15_000 })
  await page.keyboard.press("Enter")
  await page
    .getByRole("button", { name: "Copy error" })
    .waitFor({ timeout: 5_000 })
}
