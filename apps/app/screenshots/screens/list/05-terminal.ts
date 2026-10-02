import type { Page } from "playwright-core"

import {
  LOGS_CRASHED_SAMPLE,
  LOGS_STOPPED_SAMPLE,
  stubLogs,
  stubTerminal,
} from "../../fixtures/streams"
import type { Screen } from "../screen"
import {
  canvasPanels,
  ids,
  unfreeze,
  selectWorkspace,
  openTerminalTab,
  openTerminalPane,
} from "../helpers"

const screens: Screen[] = [
  {
    name: "terminal",
    description:
      "The Terminal Pane open on a new shell running a test and printing all 16 ANSI colours (#1341).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: stubTerminal,
    prepare: openTerminalTab,
    settleMs: 600,
  },
  {
    name: "terminal-pane-footnote",
    description:
      "A Workspace's chat at full height, its terminals named in the footnote under the composer (#1341).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: stubTerminal,
    prepare: async (page) => {
      await openTerminalTab(page)
      await page.getByRole("button", { name: "Hide terminal" }).click()
      await page.mouse.move(0, 0)
    },
    settleMs: 600,
  },
  {
    name: "terminal-pane-dev-server",
    description:
      "The Terminal Pane open under the chat on Dev server, the dev server's output (#1341).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: async (page) => {
      await stubTerminal(page)
      await stubLogs(page, "live")
    },
    prepare: async (page) => {
      await openTerminalTab(page)
      await page.getByRole("tab", { name: "Dev server" }).click()
      await page.mouse.move(0, 0)
    },
    settleMs: 600,
  },
  {
    name: "terminal-pane-footnote-stopped",
    description:
      "A Workspace whose dev server was stopped: a quiet dot and Run at the footnote's right edge (#1342).",
    path: `/${ids.rooms.frameStates}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await selectWorkspace(page, "Price alerts")
      await page
        .getByRole("button", { name: "Run", exact: true })
        .first()
        .waitFor({ timeout: 15_000 })
      await page.mouse.move(0, 0)
    },
    settleMs: 600,
  },
  {
    name: "terminal-pane-stopped",
    description:
      "The Terminal Pane open on a stopped Dev server: its output up to the stop, and Run in the bar (#1342).",
    path: `/${ids.rooms.frameStates}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: (page) => stubLogs(page, "live", LOGS_STOPPED_SAMPLE),
    prepare: async (page) => {
      await openTerminalPane(page, "Dev server", "Price alerts")
      await page.mouse.move(0, 0)
    },
    settleMs: 600,
  },
  {
    name: "terminal-pane-crashed",
    description:
      "The Terminal Pane open on a crashed Dev server: a red dot, with Run in the bar (#1342).",
    path: `/${ids.rooms.frameStates}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: (page) => stubLogs(page, "live", LOGS_CRASHED_SAMPLE),
    prepare: async (page) => {
      await openTerminalPane(page, "Dev server", "Open houses")
      // The preview fails its probe twice before the dot turns red.
      await page
        .locator('[role="tab"] [data-dev-server-state="crashed"]')
        .waitFor({ timeout: 30_000 })
      await page.mouse.move(0, 0)
    },
    settleMs: 600,
  },
  {
    name: "terminal-tabs-restored",
    description:
      "A cold room load with the Workspace's two saved terminals named in its Terminal Pane footnote.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: stubTerminal,
    prepare: (page) => selectWorkspace(page, "Checkout polish"),
    settleMs: 600,
  },
  {
    name: "terminal-tab-rename",
    description:
      "A terminal tab's label in rename mode, in the Terminal Pane's tab strip (#918, #1341).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: stubTerminal,
    prepare: async (page) => {
      // Opened rather than restored (see `openTerminalTab`).
      await openTerminalTab(page)
      await page
        .getByRole("tab")
        .getByText("Terminal", { exact: true })
        .last()
        .dblclick({ timeout: 15_000 })
    },
    settleMs: 600,
  },
  {
    name: "terminal-close-confirm",
    description:
      "× on a terminal tab that's running Claude Code: Close asks first (I12).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: stubTerminal,
    prepare: async (page) => {
      await unfreeze(page)
      await openTerminalTab(page)
      // The fixture has no live session to read, so answer the close's
      // session check as a running harness would.
      await answerTerminalActivity(page, "claude")
      const tab = page
        .locator("[data-tab-id]")
        .filter({ has: page.getByRole("button", { name: "Close terminal" }) })
        .last()
      await tab.hover({ timeout: 15_000 })
      await tab
        .getByRole("button", { name: "Close terminal" })
        .click({ timeout: 5_000 })
      await page.getByRole("alertdialog").waitFor({ timeout: 10_000 })
    },
    settleMs: 400,
  },
  {
    name: "logs-reconnecting",
    description:
      "The sandbox logs panel with coloured output, dropped and reconnecting.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: (page) => stubLogs(page, "reconnecting"),
    prepare: openLogsTab,
    settleMs: 600,
  },
  {
    name: "logs-error",
    description: "The sandbox logs panel after the stream keeps failing.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: (page) => stubLogs(page, "error"),
    prepare: openLogsTab,
    // Long enough for the panel to exhaust its quick retries.
    settleMs: 6000,
  },
]

export default screens

/**
 * Answer a terminal close's session check (`terminalSessionActivityAction`)
 * with `command`, as a sandbox running it would. Matched on the action's
 * arguments, so every other action still reaches the server.
 */
async function answerTerminalActivity(
  page: Page,
  command: string
): Promise<void> {
  await page.route("**/*", (route) => {
    const request = route.request()
    const body = request.postData() ?? ""
    if (
      request.method() === "POST" &&
      request.headers()["next-action"] &&
      body.includes("terminalSessionId") &&
      body.includes("sandboxName") &&
      !body.includes("label")
    ) {
      return route.fulfill({
        status: 200,
        contentType: "text/x-component",
        body: `0:{"a":"$@1","f":"","b":"fixture"}\n1:${JSON.stringify(command)}\n`,
      })
    }
    return route.fallback()
  })
}

/** Open the Terminal Pane on Dev server, the dev server's output (#1341). */
async function openLogsTab(page: Page): Promise<void> {
  await openTerminalPane(page, "Dev server")
}
