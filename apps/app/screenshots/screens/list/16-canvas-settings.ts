import type { Page } from "playwright-core"

import { fixtureGitHubCookieName } from "@/lib/fixture-github"

import type { Screen } from "../screen"
import {
  canvasPanels,
  ids,
  branchRowMenu,
  fixtureGitHub,
  openCanvasSettings,
  openCanvasOptions,
} from "../helpers"

const screens: Screen[] = [
  {
    name: "canvas-options-menu",
    description: "The canvas name's ⋯ menu: Rename, Settings, Delete (#883).",
    path: `/${ids.rooms.checkout}`,
    prepare: openCanvasOptions,
    settleMs: 300,
  },
  {
    name: "canvas-settings",
    description:
      "Canvas settings on Repositories, for a canvas with one repository (#883).",
    path: `/${ids.rooms.checkout}`,
    prepare: openCanvasSettings,
    settleMs: 400,
  },
  {
    name: "canvas-settings-two-repos",
    description:
      "Canvas settings on Repositories, for a canvas with two: one with a label (#883).",
    path: `/${ids.rooms.pricing}`,
    prepare: openCanvasSettings,
    settleMs: 400,
  },
  {
    name: "canvas-settings-empty",
    description: "Canvas settings on a canvas with no repository yet (#883).",
    path: `/${ids.rooms.empty}`,
    prepare: openCanvasSettings,
    settleMs: 400,
  },
  {
    name: "canvas-settings-memory",
    description:
      "Canvas settings on Memory: entries the Coordinator saved and one a member added (#902).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await openCanvasSettings(page)
      await page.getByRole("button", { name: "Memory" }).click()
      await page.getByText("Saved by the Coordinator").first().waitFor()
    },
    settleMs: 400,
  },
  {
    name: "canvas-settings-memory-empty",
    description:
      "Canvas settings on Memory, for a canvas with none yet (#902).",
    path: `/${ids.rooms.pricing}`,
    prepare: async (page) => {
      await openCanvasSettings(page)
      await page.getByRole("button", { name: "Memory" }).click()
      await page.getByText("No memories yet").waitFor()
    },
    settleMs: 400,
  },
  {
    name: "canvas-settings-memory-edit",
    description: "Canvas settings › Memory → Edit on an entry (#902).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await openCanvasSettings(page)
      await page.getByRole("button", { name: "Memory" }).click()
      await page
        .getByRole("button", { name: /^Edit memory: Design mobile-first/ })
        .click()
      await page.getByRole("dialog", { name: "Edit memory" }).waitFor()
    },
    settleMs: 400,
  },
  {
    name: "canvas-settings-edit",
    description:
      "Canvas settings → Edit on a repository: its run settings (#883).",
    path: `/${ids.rooms.pricing}`,
    prepare: async (page) => {
      await openCanvasSettings(page)
      await page.getByRole("button", { name: "Edit api" }).click()
      await page.getByRole("dialog", { name: "Repository settings" }).waitFor()
    },
    settleMs: 400,
  },
  {
    name: "canvas-settings-remove",
    description:
      "Canvas settings → a repository's ⋯ → Remove: the confirm listing its Workspaces (#883).",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureGitHub(),
    prepare: async (page) => {
      await openCanvasSettings(page)
      await page
        .getByRole("button", { name: "More actions for storefront" })
        .click()
      await page.getByRole("menuitem", { name: "Remove" }).click()
      await page.getByRole("alertdialog").waitFor()
      await settleDeleteConfirm(page)
    },
    settleMs: 400,
  },
  {
    name: "dialog-remove-project",
    description:
      "Removing a Project from a Canvas: its Workspaces and their state.",
    path: `/${ids.rooms.checkout}`,
    // Signed in to GitHub, so the option to delete the branches there shows.
    cookies: fixtureGitHub(),
    prepare: async (page) => {
      await openRemoveProject(page)
    },
    settleMs: 400,
  },
  {
    name: "dialog-remove-project-remote",
    description:
      "Remove project with the GitHub delete ticked: the button says so.",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureGitHub(),
    prepare: async (page) => {
      await openRemoveProject(page)
      await page.getByRole("checkbox").click()
    },
    settleMs: 400,
  },
  {
    name: "dialog-delete-workspace",
    description:
      "Deleting a Workspace with an open PR and uncommitted changes.",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureGitHub(),
    prepare: async (page) => {
      await openDeleteWorkspace(page, "Checkout polish")
    },
    settleMs: 400,
  },
  {
    name: "dialog-delete-workspace-remote",
    description:
      "Delete workspace with the GitHub delete ticked: the branch moves to Removes.",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureGitHub(),
    prepare: async (page) => {
      await openDeleteWorkspace(page, "Checkout polish")
      await page.getByRole("checkbox").click()
    },
    settleMs: 400,
  },
  {
    name: "dialog-delete-workspace-clean",
    description:
      "Deleting a clean Workspace that was never pushed: no warning.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openDeleteWorkspace(page, "Apple Pay button")
    },
    settleMs: 400,
  },
  {
    name: "dialog-delete-canvas",
    description: "Deleting a Canvas from the home grid: the confirm dialog.",
    path: "/",
    prepare: async (page) => {
      const card = page.getByLabel("Open Checkout flow").first()
      await card.hover()
      await page
        .getByRole("button", { name: "Canvas actions" })
        .first()
        .click({ timeout: 15_000 })
      await page.waitForTimeout(300)
      await page.getByRole("menuitem", { name: "Delete" }).click()
    },
    settleMs: 400,
  },
]

export default screens

/** Open Canvas settings' Remove confirm for the storefront repository. */
async function openRemoveProject(page: Page): Promise<void> {
  await openCanvasSettings(page)
  await page
    .getByRole("button", { name: "More actions for storefront" })
    .click({ timeout: 15_000 })
  // Radix ignores a select that lands in the same beat the menu opened.
  await page.waitForTimeout(300)
  await page.getByRole("menuitem", { name: "Remove" }).click()
  await settleDeleteConfirm(page)
}

/** Open a Workspace row menu's Delete confirm. */
async function openDeleteWorkspace(page: Page, ref: string): Promise<void> {
  const trigger = await branchRowMenu(page, ref)
  await trigger.click({ timeout: 15_000 })
  await page.waitForTimeout(300)
  await page.getByRole("menuitem", { name: "Delete" }).click()
  await settleDeleteConfirm(page)
}

/**
 * Wait for a delete confirm's reads to land: every Workspace's git state (its
 * row spinner gone) and, when signed in, the GitHub probe that shows the
 * option. The first open compiles the server actions, so this can take a while.
 */
async function settleDeleteConfirm(page: Page): Promise<void> {
  const dialog = page.getByRole("alertdialog")
  await dialog.waitFor({ timeout: 15_000 })
  await dialog
    .locator('[role="status"]')
    .first()
    .waitFor({ state: "detached", timeout: 60_000 })
    .catch(() => {})
  const signedIn = (await page.context().cookies()).some(
    (c) => c.name === fixtureGitHubCookieName() && c.value === "connected"
  )
  if (signedIn) {
    await dialog.getByRole("checkbox").waitFor({ timeout: 60_000 })
  }
}
