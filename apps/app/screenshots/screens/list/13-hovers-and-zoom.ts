import { stubLogs } from "../../fixtures/streams"
import type { Screen } from "../screen"
import {
  canvasPanels,
  ids,
  openChatTab,
  openTerminalPane,
  replayRun,
  delegatedWorkspaceRun,
  showTooltip,
} from "../helpers"

const screens: Screen[] = [
  {
    name: "terminal-pane-new-shell-hover",
    description:
      "Hovering + in the open Terminal Pane's tab strip, which opens a plain shell (#1341, #1343).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: (page) => stubLogs(page, "reconnecting"),
    prepare: async (page) => {
      await openTerminalPane(page)
      await page
        .getByRole("button", { name: "New terminal", exact: true })
        .first()
        .hover({ timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "composer-send-hover",
    description:
      "A drafted message with the pointer on Send: the Enter / Shift+Enter hint.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await page.locator(".ProseMirror").last().click({ timeout: 15_000 })
      await page.keyboard.type("Tighten the summary spacing")
      await page
        .locator('[title="Send"], [aria-label="Send"]')
        .last()
        .hover({ force: true, timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "composer-model-switch",
    description:
      "The model menu open in a chat that has started: its model can still change.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      // The Workspace's own chat: its earlier chats have no composer (#1315).
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, delegatedWorkspaceRun())
      await page
        .getByRole("button", { name: /^Opus 5\.5/ })
        .last()
        .click({ timeout: 15_000 })
      await page.getByRole("menuitem", { name: "Sonnet 5.5" }).waitFor()
    },
    settleMs: 400,
  },
  {
    name: "player-hud-hover",
    description: "The prototype player's HUD, hovering the knobs button.",
    path: `/play/${ids.rooms.checkout}/${ids.branches.checkoutPolish}`,
    prepare: async (page) => {
      await page
        .locator("button:has(svg.ph-sliders-horizontal)")
        .first()
        .hover({ timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "canvas-zoom-controls",
    description:
      "The zoom menu in the top-right pill, opened from its percentage button.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^Zoom, / })
        .click({ timeout: 15_000 })
      await page.getByRole("menu").waitFor({ state: "visible", timeout: 5_000 })
    },
    settleMs: 400,
  },
  {
    name: "canvas-shortcuts",
    description: "The keyboard shortcut sheet, opened with `?`.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page.mouse.move(600, 400)
      await page.keyboard.press("?")
      await page
        .getByRole("dialog")
        .waitFor({ state: "visible", timeout: 5_000 })
    },
    settleMs: 400,
  },
  {
    name: "canvas-narrow",
    description:
      "The Canvas at a narrow window, where the panels compete for width.",
    path: `/${ids.rooms.checkout}`,
    viewport: { width: 1024, height: 768 },
  },
]

export default screens
