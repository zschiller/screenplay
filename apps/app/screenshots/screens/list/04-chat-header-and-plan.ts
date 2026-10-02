import type { Page } from "playwright-core"

import type { Screen } from "../screen"
import {
  canvasPanels,
  ids,
  selectWorkspace,
  openChatsMenu,
  openChatTab,
  expandTurnSummaries,
  waitForWorkspaceHoverCard,
} from "../helpers"

const screens: Screen[] = [
  {
    name: "chat-header-workspace",
    description:
      "A Workspace's chat header (#1152): the Coordinator crumb, the Workspace's state icon and name, and its PR button. No Workspaces button: that lives on the Coordinator header.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await selectWorkspace(page, "Checkout polish")
      await page.mouse.move(900, 900)
    },
    settleMs: 400,
  },
  {
    name: "chat-header-workspace-hover-card",
    description:
      "Hovering the Workspace's name in its chat header: the Workspace hover card (#882, #1152).",
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
    name: "workspaces-menu",
    description:
      "The Chats menu open from the Coordinator (#1152, #1317): search, the Coordinator checked, every chat with + and …, and Done.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatsMenu(page)
      await page.mouse.move(900, 900)
    },
    settleMs: 400,
  },
  {
    name: "workspaces-menu-search",
    description:
      "Searching the Chats menu by branch name (#1152): Done Workspaces are searched too.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      const menu = await openChatsMenu(page)
      await menu.getByPlaceholder("Search chats…").fill("cart")
      await page.mouse.move(900, 900)
    },
    settleMs: 400,
  },
  {
    name: "chat-header-pr-none",
    description:
      "The chat header for a Workspace with no PR yet: the Create PR button.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await selectWorkspace(page, "Empty cart state")
    },
    settleMs: 400,
  },
  {
    name: "chat-header-pr-merged",
    description:
      "The chat header for a Workspace whose PR merged: the PR button in GitHub purple.",
    path: `/${ids.rooms.pricing}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: (page) => selectWorkspace(page, "Pricing tiers"),
    settleMs: 400,
  },
  {
    name: "chat-header-pr-blocked",
    description:
      "The chat header for a Workspace whose open PR can't merge: the PR button in red with the merge-blocked icon.",
    path: `/${ids.rooms.frameStates}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await selectWorkspace(page, "listing-page")
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-turn-expanded",
    description:
      "A finished turn's summary opened: diff, terminal, subagent, and failed tool calls.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "Checkout polish")
      await expandTurnSummaries(page)
    },
    settleMs: 400,
  },
  {
    name: "canvas-agent-chat-markdown",
    description:
      "A markdown-heavy agent reply: table, task list, inline code, highlighted and overflowing code blocks, expanded reasoning.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "Breakpoint audit")
      await expandTurnSummaries(page)
      await page
        .getByRole("button", { name: /^Reasoning$/ })
        .first()
        .click({ timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "canvas-plan-review",
    description: "A chat paused on a pending plan, awaiting approve/reject.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      // The chat panel opens on the Canvas's first Workspace, and the tab strip
      // only lists that Workspace's chats — so the plan's chat is reached by
      // selecting its Workspace, not by looking for a tab that isn't there yet.
      // Its chat is then restored as the Workspace's only open one.
      await selectWorkspace(page, "Empty cart state")
      await waitForPlanCard(page)
    },
    settleMs: 400,
  },
  {
    name: "canvas-plan-approve-failed",
    description:
      "Approve on a plan the server refuses: the chat's error box under the plan card.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page.route("**/api/agent/plan", (route) =>
        route.fulfill({ status: 500, body: "" })
      )
      await selectWorkspace(page, "Empty cart state")
      await waitForPlanCard(page)
      await page
        .getByRole("button", { name: "Approve", exact: true })
        .click({ timeout: 15_000 })
      await page.getByTestId("chat-error").waitFor()
      await page.mouse.move(0, 0)
    },
    settleMs: 400,
  },
  {
    name: "canvas-plan-request-changes",
    description:
      "Request changes on a pending plan: the composer is focused with the plan quoted.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await selectWorkspace(page, "Empty cart state")
      await waitForPlanCard(page)
      await page
        .getByRole("button", { name: "Request changes", exact: true })
        .click({ timeout: 15_000 })
      // Park the pointer so the button isn't caught in its hover state.
      await page.mouse.move(0, 0)
    },
    settleMs: 400,
  },
]

export default screens

/**
 * Wait for the pending plan card's actions. The chat's history loads after the
 * Workspace is selected, so without this the shot catches "Loading chat…".
 */
async function waitForPlanCard(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Approve", exact: true })
    .waitFor({ timeout: 30_000 })
}
