import type { Screen } from "../screen"
import { isHomePath, failServerActions, entryState } from "../helpers"

const screens: Screen[] = [
  {
    name: "sign-in",
    description: "The hosted sign-in page.",
    path: "/sign-in",
  },
  {
    name: "home-signed-out",
    description: "The home surface as a signed-out visitor sees it.",
    path: "/",
    cookies: entryState("signed-out"),
  },
  {
    name: "setup-pending",
    description: "The first-run setup gate with nothing done yet.",
    path: "/",
    cookies: entryState("setup-pending"),
    fullPage: true,
  },
  {
    name: "setup-agent-choices",
    description:
      "The setup gate's agent step after Change, listing every coding agent.",
    path: "/",
    cookies: entryState("setup-pending"),
    fullPage: true,
    prepare: async (page) => {
      // The first click can land before hydration; retry until the list shows.
      const change = page.getByRole("button", { name: "Change" })
      const list = page.getByRole("radiogroup", { name: "Coding agent" })
      await change.waitFor({ timeout: 15_000 })
      for (let i = 0; i < 10 && !(await list.isVisible()); i++) {
        await change.click()
        await page.waitForTimeout(300)
      }
      await list.waitFor({ timeout: 5_000 })
      // Park the pointer so no row shows its hover fill.
      await page.mouse.move(0, 0)
    },
    settleMs: 300,
  },
  {
    name: "setup-agent-start-failed",
    description:
      "The setup gate's agent step after Install fails to start: the inline error (PR 6).",
    path: "/",
    cookies: entryState("setup-pending"),
    fullPage: true,
    prepare: async (page) => {
      const install = page.getByRole("button", { name: /^Install .* sign in$/ })
      await install.waitFor({ timeout: 15_000 })
      await failServerActions(page)
      await install.click()
      await page.getByRole("alert").first().waitFor({ timeout: 10_000 })
    },
  },
  {
    name: "setup-agent-ready",
    description:
      "The setup gate with a coding agent ready and GitHub still open.",
    path: "/",
    cookies: entryState("setup-agent-ready"),
    fullPage: true,
  },
  {
    name: "setup-complete",
    description: "The setup gate once GitHub is skipped and Finish is ready.",
    path: "/",
    cookies: entryState("setup-agent-ready"),
    fullPage: true,
    prepare: async (page) => {
      // Skipping flips the gate's own skip bit; its next poll then releases
      // Finish, exactly as it does for a person at the gate.
      await page
        .getByRole("button", { name: "Skip" })
        .click({ timeout: 15_000 })
      await page
        .locator("button:not([disabled])", { hasText: "Finish" })
        .waitFor({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "setup-finish",
    description: "Finish on the setup gate: the new first Canvas it opens.",
    path: "/",
    cookies: entryState("setup-agent-ready"),
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "Skip" })
        .click({ timeout: 15_000 })
      const finish = page.locator("button:not([disabled])", {
        hasText: "Finish",
      })
      await finish.waitFor({ timeout: 15_000 })
      await finish.click()
      // Before #780 Finish stayed on home, so neither wait is required.
      await page
        .waitForURL((url) => !isHomePath(url.toString()), { timeout: 30_000 })
        .catch(() => {})
      await page
        .locator("[data-slot=getting-started]")
        .waitFor({ timeout: 30_000 })
        .catch(() => {})
    },
    settleMs: 500,
  },
]

export default screens
