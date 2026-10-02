import type { Page } from "playwright-core"

import { LOCAL_USER_ID } from "@/lib/local-user"
import {
  DEFAULT_WORKSPACE_LIST_VIEW,
  workspaceListViewKey,
  type WorkspaceListView,
} from "@/lib/workspace-list-view"

import type { Screen } from "../screen"
import {
  canvasPanels,
  ids,
  chooseFromMenu,
  branchRowMenu,
  holdServerActions,
  freezeYjs,
  CHATS_MENU,
  openChatsMenu,
  showTooltip,
  newWorkspaceButton,
} from "../helpers"

const screens: Screen[] = [
  {
    name: "workspaces-menu-new-hover",
    description:
      "Hovering the Chats menu's New chat (+) button, with its tooltip.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await newWorkspaceButton(page).then((b) => b.hover())
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "workspaces-menu-row-options-hover",
    description: "Hovering a Workspace row's overflow (…) button.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      const trigger = await branchRowMenu(page, "Checkout polish")
      await trigger.hover({ timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "workspaces-menu-row-menu-open-pr",
    description:
      "The Workspace row's … menu open on a Workspace with an open PR.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openBranchRowMenu(page, "Checkout polish")
    },
    settleMs: 400,
  },
  {
    name: "workspaces-menu-rename-title",
    description:
      "Renaming a Workspace's title in place from its row's … menu (#881). The branch is untouched.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      // Light and dark share the Canvas, and the first run's rename commits
      // on close, so find the row by either name.
      const menu = await openChatsMenu(page)
      const name = (await menu
        .getByText("Empty cart illustration", { exact: true })
        .count())
        ? "Empty cart illustration"
        : "Empty cart state"
      await chooseFromMenu(page, await branchRowMenu(page, name), "Rename")
      await page
        .locator("[data-editable-text=editing]")
        .waitFor({ timeout: 5_000 })
      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.type("Empty cart illustration")
    },
    settleMs: 400,
  },
  {
    name: "dialog-rename-branch",
    description:
      "Rename branch… from the Workspace menu's Git group (#881): renames the git branch, not the title.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openBranchRowMenu(page, "Empty cart state")
      await page
        .getByRole("menuitem", { name: "Rename branch…" })
        .click({ timeout: 10_000 })
      await page.getByRole("dialog").waitFor({ timeout: 5_000 })
    },
    settleMs: 400,
  },
  {
    name: "workspaces-menu-row-menu-changes",
    description:
      "The Workspace row's … menu open on a Workspace with changes and no PR.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openBranchRowMenu(page, "Empty cart state")
    },
    settleMs: 400,
  },
  {
    name: "workspaces-menu-row-menu-starting",
    description:
      "The Workspace row's … menu open on a Workspace still running setup.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openBranchRowMenu(page, "Apple Pay button")
    },
    settleMs: 400,
  },
  {
    name: "workspaces-menu-row-menu-failed",
    description:
      "The Workspace row's … menu open on a Workspace whose setup failed.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openBranchRowMenu(page, "gift-cards")
    },
    settleMs: 400,
  },
  {
    name: "canvas-workspace-done",
    description:
      "The reference Canvas after Mark as done on Empty cart state (#976): its Cart group is hidden and its row sits in the Chats menu's collapsed Done section.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: (page) => markWorkspaceDone(page, "Empty cart state"),
    settleMs: 600,
  },
  {
    name: "workspaces-menu-done-open",
    description:
      "The Workspaces list's Done section opened, with the Done Workspace's check-circle row (#976).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await markWorkspaceDone(page, "Empty cart state")
      await openDoneSection(page)
      await page.mouse.move(900, 900)
    },
    settleMs: 400,
  },
  {
    name: "workspaces-menu-row-menu-done",
    description:
      "A Done Workspace's … menu: Reopen leads, and only what works without its sandbox follows (#976).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await markWorkspaceDone(page, "Empty cart state")
      await openDoneSection(page)
      await openBranchRowMenu(page, "Empty cart state")
    },
    settleMs: 400,
  },
  {
    name: "canvas-workspace-done-keeps-docs",
    description:
      "The reference Canvas after Mark as done on Checkout polish: its frames are hidden, the Checkout brief stays in its Group, and a toast offers Undo.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: (page) => markWorkspaceDone(page, "Checkout polish"),
    settleMs: 600,
  },
  {
    name: "workspaces-menu-row-menu-merged",
    description:
      "A Workspace's … menu once its PR has merged: Mark as done leads.",
    path: `/${ids.rooms.pricing}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: (page) => openBranchRowMenu(page, "Rate-limit headers"),
    settleMs: 400,
  },
  {
    name: "workspaces-menu-view-menu",
    description:
      "The Workspaces … menu (#885): the Sort by submenu open, Group by state and Open existing git branch.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      const menu = await openChatsMenu(page)
      await menu
        .getByRole("button", { name: "More chat actions" })
        .click({ timeout: 15_000 })
      await page.getByRole("menuitem", { name: /^Sort by/ }).hover()
      await page
        .getByRole("menuitemradio", { name: "Manual" })
        .waitFor({ timeout: 5_000 })
    },
    settleMs: 400,
  },
  {
    name: "workspaces-menu-sort-recent",
    description:
      "The Workspaces list sorted by Recent activity (#885): the last chat turn first.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: (page) =>
      setWorkspaceListView(page, ids.rooms.checkout, { sort: "recent" }),
    settleMs: 400,
  },
  {
    name: "workspaces-menu-sort-name",
    description: "The Workspaces list sorted by Name (#885).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: (page) =>
      setWorkspaceListView(page, ids.rooms.checkout, { sort: "name" }),
    settleMs: 400,
  },
  {
    name: "workspaces-menu-grouped",
    description:
      "The Workspaces list grouped by state (#885): Working, Needs you and Idle sections, with Done still its own section once.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await setWorkspaceListView(page, ids.rooms.checkout, {
        groupByState: true,
      })
      await markWorkspaceDone(page, "Empty cart state")
    },
    settleMs: 600,
  },
  {
    name: "workspaces-menu-needs-you",
    description:
      "The Workspaces list grouped by state with nothing Done: Empty cart state's plan and Gift cards' failed setup need you; Checkout polish's open PR waits on review, so it's Idle.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await setWorkspaceListView(page, ids.rooms.checkout, {
        groupByState: true,
      })
      await page.mouse.move(900, 900)
    },
    settleMs: 600,
  },
]

export default screens

/**
 * The \`…\` menu trigger on a Workspace row, which only shows while the row is
 * hovered: hover the row, then hand back its trigger.
 */
/** Open a Workspace row's … menu and leave it open. */
async function openBranchRowMenu(page: Page, ref: string): Promise<void> {
  const trigger = await branchRowMenu(page, ref)
  await trigger.click({ timeout: 15_000, force: true })
  await page.getByRole("menu").first().waitFor({ timeout: 5_000 })
  // Park the pointer on the menu's edge so no item shows a hover highlight.
  await page.mouse.move(5, 5)
}

/**
 * Mark a Workspace done from its row's … menu (#976) without writing to the
 * Fixture World: Yjs writes are frozen, and the sandbox stop is left hanging
 * (there is no sandbox behind a fixture Workspace).
 */
async function markWorkspaceDone(page: Page, title: string): Promise<void> {
  await freezeYjs(page)
  await holdServerActions(page, "hang")
  await chooseFromMenu(page, await branchRowMenu(page, title), "Mark as done")
  await page
    .locator(CHATS_MENU)
    .locator("[cmdk-item]")
    .filter({ hasText: /^Done \(\d+\)$/ })
    .waitFor({ timeout: 10_000 })
  // Park the pointer on empty canvas so no row or frame shows its hover state.
  await page.mouse.move(900, 900)
}

/**
 * Open a Canvas with this Workspaces list view (#885), as a member who picked
 * it earlier would: the view lives in browser storage, so it is seeded before
 * the page loads and applied on the reload.
 */
async function setWorkspaceListView(
  page: Page,
  roomId: string,
  view: Partial<WorkspaceListView>
): Promise<void> {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key!, value!),
    [
      workspaceListViewKey(LOCAL_USER_ID, roomId),
      JSON.stringify({ ...DEFAULT_WORKSPACE_LIST_VIEW, ...view }),
    ]
  )
  await page.reload()
  await openChatsMenu(page)
}

/** Open the Chats menu's Done section (#976). */
async function openDoneSection(page: Page): Promise<void> {
  const menu = await openChatsMenu(page)
  await menu
    .locator("[cmdk-item]")
    .filter({ hasText: /^Done \(\d+\)$/ })
    .click({ timeout: 10_000 })
}
