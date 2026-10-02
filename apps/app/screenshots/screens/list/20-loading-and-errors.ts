import type { Page } from "playwright-core"

import { fixtureFaultCookieName, type FixtureFault } from "@/lib/fixture-faults"

import type { Screen } from "../screen"
import {
  presetRowAction,
  holdServerActions,
  failServerActions,
  dragOnto,
  unfreeze,
} from "../helpers"

const screens: Screen[] = [
  {
    name: "home-load-error",
    description: "Recents when the Canvas list fails to load.",
    path: "/",
    cookies: fixtureFault("home-load"),
  },
  {
    name: "settings-loading",
    description: "Settings → Coding agents while its rows are still checking.",
    path: "/settings?section=coding-agents",
    fullPage: true,
    beforeNavigate: (page) => holdServerActions(page, "hang"),
    settleMs: 500,
  },
  {
    name: "settings-presets-empty",
    description: "Settings with no saved Project presets.",
    path: "/settings?section=repository-presets",
    fullPage: true,
    cookies: fixtureFault("no-presets"),
  },
  {
    name: "settings-edit-preset",
    description: "Settings → editing a saved Project preset.",
    path: "/settings?section=repository-presets",
    fullPage: true,
    prepare: async (page) => {
      const edit = page.getByRole("button", { name: "Edit", exact: true })
      await edit.first().click({ timeout: 30_000 })
      await page.getByLabel("Preset name").waitFor({ timeout: 10_000 })
    },
    settleMs: 300,
  },
  {
    name: "settings-new-preset",
    description: "Settings → New preset: choosing the preset's source.",
    path: "/settings?section=repository-presets",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "New preset" })
        .first()
        .click({ timeout: 30_000 })
      await page.getByRole("dialog").waitFor({ timeout: 10_000 })
      await page.mouse.move(0, 0)
    },
    settleMs: 500,
  },
  {
    name: "settings-duplicate-preset",
    description: "Settings → a saved Project preset's … menu → Duplicate.",
    path: "/settings?section=repository-presets",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "More actions" })
        .first()
        .waitFor({ timeout: 30_000 })
      await presetRowAction(page, "Duplicate")
      await page.getByLabel("Preset name").waitFor({ timeout: 10_000 })
    },
    settleMs: 300,
  },
  {
    name: "settings-discard-preset",
    description:
      "Settings → editing a preset, then Cancel with unsaved changes.",
    path: "/settings?section=repository-presets",
    prepare: async (page) => {
      const edit = page.getByRole("button", { name: "Edit", exact: true })
      await edit.first().click({ timeout: 30_000 })
      const setup = page.getByLabel("Setup script")
      await setup.waitFor({ timeout: 10_000 })
      await setup.fill("pnpm install --frozen-lockfile")
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click()
      await page.getByRole("alertdialog").waitFor({ timeout: 10_000 })
    },
    settleMs: 300,
  },
  {
    name: "settings-load-error",
    description: "Settings → Coding agents when its check fails.",
    path: "/settings?section=coding-agents",
    fullPage: true,
    beforeNavigate: failServerActions,
    settleMs: 500,
  },
  {
    name: "home-create-error",
    description: "Home after pressing New canvas fails: the error toast.",
    path: "/",
    prepare: async (page) => {
      await unfreeze(page)
      await failServerActions(page)
      // The header button can be clicked before hydration wires it up, so
      // retry until the create has visibly failed.
      const toast = page.locator("[data-sonner-toast]")
      for (let i = 0; i < 5 && !(await toast.count()); i++) {
        await page.getByRole("button", { name: "New canvas" }).first().click()
        await page.waitForTimeout(800)
      }
      await page.mouse.move(0, 0)
    },
    settleMs: 300,
  },
  {
    name: "home-rename-error",
    description: "The Rename dialog after renaming a Canvas fails.",
    path: "/",
    prepare: async (page) => {
      await unfreeze(page)
      await failServerActions(page)
      await openCanvasMenu(page, "Checkout flow")
      await page.getByRole("menuitem", { name: "Rename" }).click()
      await page.getByRole("dialog").getByRole("textbox").fill("Checkout v2")
      await page.getByRole("button", { name: "Save" }).click()
      await page.waitForTimeout(800)
    },
    settleMs: 300,
  },
  {
    name: "home-rename-unchanged",
    description:
      "The Rename dialog as it opens: Save waits for a new name (PR 6).",
    path: "/",
    prepare: async (page) => {
      await unfreeze(page)
      await openCanvasMenu(page, "Checkout flow")
      await page.getByRole("menuitem", { name: "Rename" }).click()
      await page.getByRole("dialog").getByRole("textbox").waitFor()
    },
    settleMs: 300,
  },
  {
    name: "home-rename-saving",
    description:
      "The Rename dialog while the rename is in flight: spinner, no dismissing (PR 6).",
    path: "/",
    prepare: async (page) => {
      await unfreeze(page)
      await openCanvasMenu(page, "Checkout flow")
      await page.getByRole("menuitem", { name: "Rename" }).click()
      await page.getByRole("dialog").getByRole("textbox").fill("Checkout v2")
      // Hold every server action so the dialog is caught mid-save.
      await page.route("**/*", (route) =>
        route.request().method() === "POST" &&
        route.request().headers()["next-action"]
          ? undefined
          : route.fallback()
      )
      await page.getByRole("button", { name: "Save" }).click()
      await page.waitForTimeout(500)
    },
    settleMs: 300,
  },
  {
    name: "home-rename-selection",
    description:
      "The Rename dialog with the Canvas name selected in its input: the accent selection tint (#1033).",
    path: "/",
    prepare: async (page) => {
      await unfreeze(page)
      await openCanvasMenu(page, "Checkout flow")
      await page.getByRole("menuitem", { name: "Rename" }).click()
      await page.getByRole("dialog").getByRole("textbox").selectText()
    },
    settleMs: 300,
  },
  {
    name: "home-pin-error",
    description: "The error toast after pinning a Canvas fails.",
    path: "/",
    prepare: async (page) => {
      await unfreeze(page)
      await failServerActions(page)
      await openCanvasMenu(page, "Checkout flow")
      await page
        .getByRole("menuitem", { name: /^(Pin to sidebar|Unpin)$/ })
        .click()
      await page.waitForTimeout(1000)
    },
    settleMs: 300,
  },
  {
    name: "home-move-error",
    description:
      "The error toast after dragging a Canvas into a Folder fails; the tile is back.",
    path: "/files",
    prepare: async (page) => {
      await unfreeze(page)
      await failServerActions(page)
      await dragOnto(page, "Empty canvas", "Marketing site")
      await page.mouse.up()
      await page.mouse.move(0, 0)
      await page.waitForTimeout(1000)
    },
    settleMs: 300,
  },
  {
    name: "github-connect-error",
    description: "The GitHub device-code dialog after starting the flow fails.",
    path: "/settings?section=github",
    cookies: fixtureFault("github-device-flow"),
    prepare: async (page) => {
      await unfreeze(page)
      await page
        .getByRole("button", { name: "Connect with a device code instead" })
        .click({ timeout: 15_000 })
      await page.waitForTimeout(1000)
    },
    settleMs: 300,
  },
  {
    name: "sign-in-error",
    description: "The sign-in page after the GitHub redirect fails to start.",
    path: "/sign-in",
    beforeNavigate: async (page) => {
      await page.route("**/api/auth/sign-in/social*", (route) =>
        route.fulfill({ status: 500, body: "simulated failure" })
      )
    },
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "Continue with GitHub" })
        .click({ timeout: 15_000 })
      await page.waitForTimeout(1000)
    },
    settleMs: 300,
  },
]

export default screens

/**
 * The cookie that asks the Fixture World for a server-side failure
 * (`@/lib/fixture-faults`) — one the browser can't cause, like the home layout's
 * own Canvas load.
 */
function fixtureFault(
  fault: FixtureFault
): Array<{ name: string; value: string }> {
  return [{ name: fixtureFaultCookieName(), value: fault }]
}

/** Hover a Canvas tile on the home grid and open its ⋯ actions menu. */
async function openCanvasMenu(page: Page, name: string): Promise<void> {
  await page.getByLabel(`Open ${name}`).first().hover()
  await page
    .getByRole("button", { name: "Canvas actions" })
    .first()
    .click({ timeout: 15_000 })
  await page.getByRole("menu").first().waitFor({ timeout: 5_000 })
  await page.waitForTimeout(300)
}
