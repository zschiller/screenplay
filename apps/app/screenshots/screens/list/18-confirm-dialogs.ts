import type { Page } from "playwright-core"

import type { Screen } from "../screen"
import {
  canvasPanels,
  ids,
  presetRowAction,
  chooseFromMenu,
  rowMenuTrigger,
  branchRowMenu,
  holdServerActions,
  freezeYjs,
} from "../helpers"

const screens: Screen[] = [
  // --- Confirm dialogs (issue #724) -----------------------------------------
  // Each opens a destructive action's confirm and stops there; none of them
  // confirms for real, so the Fixture World is never mutated. The pending and
  // error states hold every server action (see `holdServerActions`), and the
  // screens that write to the canvas doc cut the Yjs socket first (see
  // `freezeYjs`), so e.g. a Workspace's transient `starting` status never
  // reaches the persisted doc.
  {
    name: "confirm-delete-canvas",
    description: "Home → a Canvas's … menu → Delete: the delete confirm.",
    path: "/files",
    prepare: async (page) => {
      await chooseFromMenu(
        page,
        page.getByRole("button", { name: "Canvas actions" }).first(),
        "Delete"
      )
    },
    settleMs: 300,
  },
  {
    name: "confirm-delete-canvas-pending",
    description: "The Canvas delete confirm while the delete is in flight.",
    path: "/files",
    prepare: async (page) => {
      await holdServerActions(page, "hang")
      await chooseFromMenu(
        page,
        page.getByRole("button", { name: "Canvas actions" }).first(),
        "Delete"
      )
      await confirmDialog(page, "Delete")
    },
    settleMs: 300,
  },
  {
    name: "confirm-delete-canvas-error",
    description: "The Canvas delete confirm after the delete failed.",
    path: "/files",
    prepare: async (page) => {
      await holdServerActions(page, "fail")
      await chooseFromMenu(
        page,
        page.getByRole("button", { name: "Canvas actions" }).first(),
        "Delete"
      )
      await confirmDialog(page, "Delete")
      await page
        .getByRole("alertdialog")
        .locator(".text-destructive")
        .first()
        .waitFor({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "confirm-delete-folder",
    description: "Home → a Folder's … menu → Delete: the cascade confirm.",
    path: "/files",
    prepare: async (page) => {
      await chooseFromMenu(
        page,
        page.getByRole("button", { name: "Folder actions" }).first(),
        "Delete"
      )
    },
    settleMs: 300,
  },
  {
    name: "confirm-recreate-workspace",
    description: "Canvas sidebar → a Workspace's … → Restart → Recreate.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await chooseFromMenu(
        page,
        await branchRowMenu(page, "Empty cart state"),
        ["Restart", "Recreate from scratch"]
      )
    },
    settleMs: 300,
  },
  {
    name: "confirm-recreate-workspace-pending",
    description: "The Recreate confirm after confirming, while it runs.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await freezeYjs(page)
      await holdServerActions(page, "hang")
      await chooseFromMenu(
        page,
        await branchRowMenu(page, "Empty cart state"),
        ["Restart", "Recreate from scratch"]
      )
      await confirmDialog(page, "Recreate")
    },
    settleMs: 600,
  },
  {
    name: "confirm-recreate-workspace-error",
    description: "The Recreate confirm after the recreation failed.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await freezeYjs(page)
      await holdServerActions(page, "fail")
      await chooseFromMenu(
        page,
        await branchRowMenu(page, "Empty cart state"),
        ["Restart", "Recreate from scratch"]
      )
      await confirmDialog(page, "Recreate")
      await page
        .getByRole("alertdialog")
        .locator(".text-destructive")
        .first()
        .waitFor({ timeout: 15_000 })
        .catch(() => {})
    },
    settleMs: 600,
  },
  {
    name: "delete-frame",
    description:
      "Canvas sidebar → a frame's … menu → Delete: it goes at once, with no toast (⌘Z brings it back).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      // Frozen so the delete happens on screen only, never in the persisted
      // world.
      await freezeYjs(page)
      await chooseFromMenu(page, rowMenuTrigger(page, "Empty cart"), ["Delete"])
      await page
        .getByText("Empty cart", { exact: true })
        .waitFor({ state: "detached" })
    },
    settleMs: 300,
  },
  {
    name: "delete-group",
    description:
      "Canvas sidebar → a Group's … menu → Delete: its frames go at once, with no toast (⌘Z brings them back).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await freezeYjs(page)
      await chooseFromMenu(page, rowMenuTrigger(page, "Checkout"), ["Delete"])
      await page
        .getByText("Empty cart", { exact: true })
        .waitFor({ state: "detached" })
    },
    settleMs: 300,
  },
  {
    name: "confirm-delete-preset",
    description: "Settings → a saved Project preset's … menu → Delete.",
    path: "/settings?section=repository-presets",
    prepare: async (page) => {
      // Wait for the presets to load before holding server actions (the list
      // itself loads through one), then hold them so a build without the
      // confirm deletes nothing for real.
      await page
        .getByRole("button", { name: /^(Delete|More actions)$/ })
        .first()
        .waitFor({ timeout: 30_000 })
      await holdServerActions(page, "hang")
      await presetRowAction(page, "Delete")
    },
    settleMs: 300,
  },
]

export default screens

/** Click the confirm dialog's action button. */
async function confirmDialog(page: Page, verb: string): Promise<void> {
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: verb, exact: true })
    .click({ timeout: 10_000 })
}
