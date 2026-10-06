import type { Page } from "playwright-core"

import { stubFrameStream, stubTerminal } from "../fixtures/streams"
import { type Screen } from "./screen"
import {
  canvasPanels,
  ids,
  chooseFromMenu,
  entryState,
  homeView,
  unfreeze,
  selectWorkspace,
  openChatsMenu,
  openChatTab,
  openTerminalTab,
  type RunEvent,
  replayRun,
  text,
  questionRun,
  showTooltip,
  waitForWorkspaceHoverCard,
  selectCheckoutFrame,
  fixtureGitHub,
  openCanvasSettings,
  openAddProject,
} from "./helpers"

/**
 * The **core screens**: one or two per main surface, committed so every
 * branch can shoot the same baseline. Keep this list short. A PR's own
 * screens (the state it changes, opened just so) go in `./scratch/`, which is
 * gitignored: write them there, shoot before and after, and leave them out of
 * the commit.
 */
export const CORE_SCREENS: Screen[] = [
  {
    name: "home-recents",
    description: "Home → Recents: the recency-ordered grid of every Canvas.",
    path: "/",
  },
  {
    name: "home-folder",
    description: "Inside a Folder, with the breadcrumb and a nested Folder.",
    path: `/files/${ids.folders.designSystem}`,
  },
  {
    name: "home-table-view",
    description: "The home grid switched to its table layout.",
    path: "/files",
    cookies: homeView("table"),
  },
  {
    name: "home-search",
    description:
      "Home search (#807): a popover of results from every folder, each naming where it lives.",
    path: "/files",
    prepare: async (page) => {
      await searchHome(page, "design")
    },
  },
  {
    name: "settings",
    description: "Settings → General (the page's default section).",
    path: "/settings",
    fullPage: true,
  },
  {
    name: "settings-coding-agents",
    description:
      "Settings → Agent: the default model and one row per coding agent.",
    path: "/settings?section=coding-agents",
    fullPage: true,
  },
  {
    name: "settings-presets",
    description: "Settings → Repositories.",
    path: "/settings?section=repositories",
    fullPage: true,
  },
  {
    name: "canvas",
    description:
      "The reference Canvas: two Groups, a Document Layer, an unbound frame, the Workspace sidebar.",
    path: `/${ids.rooms.checkout}`,
  },
  {
    name: "canvas-empty",
    description: "A Canvas with nothing on it — the empty state.",
    path: `/${ids.rooms.empty}`,
  },
  {
    name: "canvas-documents",
    description: "A Canvas of Document Layers only, no Project attached.",
    path: `/${ids.rooms.tokens}`,
  },
  {
    name: "canvas-agent-chat",
    description:
      "The agent chat panel: a finished turn's steps folded into one summary line, with a failure chip.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "Checkout polish")
    },
    settleMs: 400,
  },
  {
    name: "chat-coordinator",
    description:
      "The chat panel's home with no Workspace selected: the canvas's Coordinator chat, empty (#893).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
    },
    settleMs: 400,
  },
  {
    name: "workspaces-menu",
    description:
      "The Chats menu open from the Coordinator (#1152, #1317): search, every chat with + and …, and Done.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatsMenu(page)
      await page.mouse.move(900, 900)
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
    name: "canvas-chat-streaming",
    description: "A run mid-stream, with assistant text already arriving.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, streamingRun())
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-question",
    description:
      "A chat asking a question as a card: one button per option, the recommended one marked (#1312).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, questionRun())
      await page
        .getByTestId("question-card")
        .first()
        .waitFor({ timeout: 10_000 })
    },
    settleMs: 400,
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
    name: "canvas-frame-toolbar",
    description:
      "A selected frame's floating toolbar, hovering Interact to show the tooltip.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await selectCheckoutFrame(page)
      await page
        .locator("#frame-toolbar-portal")
        .getByRole("button", { name: "Interact" })
        .hover({ timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "canvas-frame-go-live",
    description:
      "A hosted frame nobody is live on: its toolbar, hovering Go live to show the tooltip.",
    hosted: true,
    path: `/${ids.rooms.checkout}`,
    beforeNavigate: stubFrameStream,
    prepare: async (page) => {
      await selectCheckoutFrame(page)
      await endLive(page)
      await frameToolbarButton(page, "Go live").hover({ timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "canvas-frame-live",
    description:
      "A hosted frame you went live on: the pressed Go live toggle, its tooltip, and the Live badge.",
    hosted: true,
    path: `/${ids.rooms.checkout}`,
    beforeNavigate: stubFrameStream,
    prepare: async (page) => {
      await selectCheckoutFrame(page)
      await goLive(page)
      await frameToolbarButton(page, "Live").hover({ timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "add-project-github",
    description:
      "New repository → Open GitHub repository: the signed-in account's repos.",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureGitHub(),
    prepare: async (page) => {
      await openAddProject(page, "github")
      await page.getByText("acme/docs").first().waitFor({ timeout: 15_000 })
    },
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
    name: "player",
    description: "Play mode for a running Workspace.",
    path: `/play/${ids.rooms.checkout}/${ids.branches.checkoutPolish}`,
  },
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
    name: "setup-pending",
    description: "The first-run setup gate with nothing done yet.",
    path: "/",
    cookies: entryState("setup-pending"),
    fullPage: true,
  },
  {
    name: "player-comments",
    description:
      "The player on /checkout with its Workspace's comment pins on the page.",
    hosted: true,
    path: playerCommentsPath(),
    prepare: async (page) => {
      await page
        .locator("[data-comment-pin]")
        .first()
        .waitFor({ timeout: 30_000 })
        .catch(() => {})
    },
    settleMs: 300,
  },
  {
    name: "canvas-comments-list",
    description:
      "The canvas's comment list: the same threads the player shows, the player's included.",
    hosted: true,
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await unfreeze(page)
      await openCommentList(page)
    },
    settleMs: 400,
  },
]

/** A button in the selected frame's toolbar, by its label. */
export function frameToolbarButton(page: Page, name: string) {
  return page
    .locator("#frame-toolbar-portal")
    .getByRole("button", { name, exact: true })
}

/**
 * End live on the selected frame if it's live. Live is the frame's, stored in
 * the room like its route, so an earlier shot (the other theme) can leave it
 * on.
 */
export async function endLive(page: Page): Promise<void> {
  const goLive = frameToolbarButton(page, "Go live")
  const live = frameToolbarButton(page, "Live")
  await goLive.or(live).first().waitFor({ timeout: 15_000 })
  if (await live.isVisible()) {
    await live.click()
    // Own copies open once they're seeded (the stub answers at once): until
    // then the frame still shows, and watches, the live stream.
    await page.waitForTimeout(500)
  }
  await goLive.waitFor({ timeout: 15_000 })
}

/** Go live on the selected frame, from off. */
export async function goLive(page: Page): Promise<void> {
  await endLive(page)
  await frameToolbarButton(page, "Go live").click()
}

/**
 * Focus home search with its `/` shortcut and type a query. The first key can
 * land before hydration wires the shortcut, so retry until the field has focus.
 */
async function searchHome(page: Page, query: string): Promise<void> {
  const field = page.getByLabel("Search canvases and folders")
  await field.waitFor({ timeout: 15_000 })
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.keyboard.press("/")
    if (await field.evaluate((el) => el === document.activeElement)) break
    await page.waitForTimeout(250)
  }
  await page.keyboard.type(query)
}

/**
 * Wait for the pending plan card's actions. The chat's history loads after the
 * Workspace is selected, so without this the shot catches "Loading chat…".
 */
async function waitForPlanCard(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Approve", exact: true })
    .waitFor({ timeout: 30_000 })
}

/** A run part-way through: the prompt, a finished tool call, and half a reply. */
function streamingRun(): RunEvent[] {
  return [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "user_message_chunk",
        content: text("Make the order summary sticky on mobile."),
      },
    },
    { type: "chat-stream-start" },
    { type: "chat-control", control: { kind: "steerable", steerable: true } },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "fixture-read",
        title: "Read app/checkout/summary.tsx",
        kind: "read",
        status: "completed",
      },
    },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text(
          "The summary sits in the right column, so on mobile it lands under the form. I'll pin it to the bottom of the viewport below 768px and"
        ),
      },
    },
  ]
}

/** The player on the Checkout canvas's Mobile checkout Workspace, at /checkout. */
function playerCommentsPath(): string {
  return `/play/${ids.rooms.checkout}/${ids.branches.checkoutPolish}?route=/checkout`
}

/**
 * Open the comment list: the count button in the canvas top bar or the player
 * HUD (before #789, the HUD's Comments panel). Retried, since a click can land
 * before hydration wires the button.
 */
async function openCommentList(page: Page): Promise<void> {
  const button = page
    .getByRole("button", { name: /^(\d+ comments?(, \d+ unread)?|Comments)$/ })
    .first()
  const list = page.getByText(/^(Comments|Workspace comments)$/)
  for (let i = 0; i < 5 && !(await list.count()); i++) {
    await button.click({ timeout: 15_000 })
    await page.waitForTimeout(500)
  }
}
