import type { Screen } from "../screen"
import { failServerActions, fixtureGitHub } from "../helpers"

const screens: Screen[] = [
  {
    name: "settings",
    description: "Settings → General (the page's default section).",
    path: "/settings",
    fullPage: true,
  },
  {
    name: "settings-coding-agents",
    description:
      "Settings → Coding agents: the default agent and one row per CLI.",
    path: "/settings?section=coding-agents",
    fullPage: true,
  },
  {
    name: "settings-coding-agents-start-failed",
    description:
      "Settings → Coding agents after an Install fails to start: the inline error (PR 6).",
    path: "/settings?section=coding-agents",
    fullPage: true,
    prepare: async (page) => {
      const install = page
        .getByRole("button", { name: /^(Install|Sign in)/ })
        .first()
      await install.waitFor({ timeout: 15_000 })
      await failServerActions(page)
      await install.click()
      await page.getByRole("alert").first().waitFor({ timeout: 10_000 })
    },
  },
  {
    name: "settings-github",
    description: "Settings → GitHub, connected.",
    path: "/settings?section=github",
    cookies: fixtureGitHub(),
    fullPage: true,
  },
  {
    name: "settings-github-signed-out",
    description: "Settings → GitHub with no connection.",
    path: "/settings?section=github",
    fullPage: true,
  },
  {
    name: "settings-presets",
    description: "Settings → Repository presets.",
    path: "/settings?section=repository-presets",
    fullPage: true,
  },
  {
    name: "settings-account",
    description: "Settings → Account: the desktop app and its version.",
    path: "/settings?section=account",
    beforeNavigate: async (page) => {
      // Stand in for the desktop shell's app plugin, which the version reads.
      // A source string, not a function: tsx's name-keeping breaks function
      // init scripts in the page (see `openThemedContext`).
      await page.addInitScript({
        content: `window.__TAURI_INTERNALS__ = {
          invoke: async (cmd) => (cmd === "plugin:app|version" ? "0.1.1" : null),
        }`,
      })
    },
    fullPage: true,
  },
  {
    name: "settings-default-agent",
    description: "Settings: the Default agent menu open on Coding agents.",
    path: "/settings?section=coding-agents",
    prepare: async (page) => {
      const trigger = page.getByRole("button", { name: "Default agent" })
      const menu = page.getByRole("menu")
      // The first click can land before hydration or before the catalog
      // loads (the trigger is disabled until then); retry until it opens.
      for (let i = 0; i < 20 && !(await menu.isVisible()); i++) {
        await trigger.click({ timeout: 5_000 })
        await menu.waitFor({ timeout: 500 }).catch(() => {})
      }
      await menu.waitFor()
    },
    settleMs: 300,
  },
]

export default screens
