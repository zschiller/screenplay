import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Locator, Page } from "playwright-core"
import * as Y from "yjs"

import {
  DEFAULT_VIEW_PREFS,
  homeViewPrefsCookieName,
  withView,
  type View,
} from "@/lib/home-view-prefs"
import {
  fixtureEntryCookieName,
  type FixtureEntryState,
} from "@/lib/fixture-entry"
import { fixtureFaultCookieName, type FixtureFault } from "@/lib/fixture-faults"
import { fixtureGitHubCookieName } from "@/lib/fixture-github"
import { fixtureModelCookieName } from "@/lib/fixture-model"
import { panelLayoutCookieName } from "@/lib/panel-layout"
import { roomChatId } from "@/lib/chat/room-chat"
import { prependTurnMarkers } from "@/lib/agent/message-markers"
import { sentToWorkspaceResult } from "@/lib/agent/workspace-task"
import { getRoomCollections, type RoomCollections } from "@/lib/yjs/schema"

import { stubLogs, stubTerminal } from "./fixtures/streams"
import { COLD_WORKSPACE_PREFIX } from "./lib/preview-url"
import { FIXTURE_IDS } from "./fixtures/world"
import { settle } from "./lib/browser"

/**
 * The **named screen list** — every surface a capture run shoots, in order.
 *
 * This is the file a design-polish ticket edits. A new screen is a `name`, a
 * `path`, and (only if the surface needs opening) a `prepare` that clicks it into
 * view; everything else — light and dark, the viewport, settling, the output
 * filename — is the runner's job (`./lib/capture.ts`). Keeping the list
 * declarative is what makes a before/after pair comparable: both halves shoot the
 * same names in the same order at the same size, so the two directories diff
 * file-for-file.
 *
 * Paths are built from {@link FIXTURE_IDS} rather than written out, so a Canvas
 * renamed in the Fixture World can't leave a screen pointing at a 404.
 */

export interface Screen {
  /** Filename stem and the name you pass to `--screens`. Kebab-case. */
  name: string
  /** One line on what this screen is for, printed by `--list`. */
  description: string
  /** Path under the app origin, e.g. `/` or `/room-checkout-flow`. */
  path: string
  /**
   * Viewport for this screen. Defaults to {@link DEFAULT_VIEWPORT}. Override for
   * a surface whose layout is the point (a narrow window, a tall settings page).
   */
  viewport?: { width: number; height: number }
  /**
   * Click the surface into the state being captured — open a panel, select a tab,
   * hover a row. Runs after the page has settled and before the shot, once per
   * theme (each theme gets a fresh page), so it must be idempotent-by-construction
   * rather than assume a clean slate.
   *
   * Prefer accessible roles and visible text over test ids: a screen list that
   * reads like a user's steps survives a refactor of the markup it points at.
   */
  prepare?: (page: Page) => Promise<void>
  /**
   * Shoot this screen against the hosted build (`--hosted`), for a surface the
   * local build strips: comments above all (#789). A hosted run shoots only
   * these screens and a local run skips them, so each set stays comparable.
   */
  hosted?: boolean
  /**
   * Extra settle time in ms *after* `prepare`, for a surface with an entrance
   * animation the runner's generic wait can't see. Keep it small and rare — a
   * fixed sleep is the least reliable thing in a capture.
   */
  settleMs?: number
  /** Capture the full scrollable page rather than just the viewport. */
  fullPage?: boolean
  /**
   * Cookies set before the first navigation — the app's first-paint state comes
   * from these (resizable panel widths above all). Prefer them over a `prepare`
   * click whenever the state *is* a cookie: the screen paints correct rather than
   * being clicked correct, so there is no flash and nothing to break.
   */
  cookies?: Array<{ name: string; value: string }>
  /**
   * Runs on the fresh page before the first navigation — for state that has to
   * be in place before the app loads, like holding the Yjs connection so a
   * loading state stays on screen long enough to photograph, or stubbing a
   * stream the fixture world's (absent) sandbox can't answer
   * (`./fixtures/streams.ts`).
   */
  beforeNavigate?: (page: Page) => Promise<void>
}

/**
 * Hold every WebSocket open without ever answering it, so the Canvas stays on
 * its loading skeleton: the room provider paints the skeleton until the Y.Doc
 * syncs, and a socket nobody speaks on never syncs. Used by the loading screen
 * and recording, which would otherwise be gone before the first frame.
 */
export async function holdYjsConnection(page: Page): Promise<void> {
  await page.routeWebSocket(/.*/, () => {
    // Not connecting to the server is the point: the socket opens and stays
    // silent.
  })
}

/**
 * Make the Canvas throw as it mounts, so the route's error boundary catches it.
 *
 * The fixture world can't make the server render fail on demand, but the route
 * has one boundary for the server render and the client Canvas alike, so any
 * throw inside it paints the same page. `ResizeObserver` is constructed by the
 * panel layout on mount and nowhere before the Canvas, so failing it reaches
 * exactly that boundary and nothing earlier.
 */
export async function breakCanvasMount(page: Page): Promise<void> {
  await page.addInitScript(`
    window.ResizeObserver = class {
      constructor() {
        throw new Error("screenshot harness: simulated Canvas failure")
      }
    }
  `)
}

/**
 * The cookie that opens the canvas's chat panel. The chat panel defaults to 0px
 * (collapsed), so every chat screen seeds it rather than clicking ⌘I — the shot
 * then paints correct instead of being toggled correct.
 *
 * The values are **percentages of the group**, which is the shape
 * `react-resizable-panels` persists, and all three panels must be named or the
 * layout is ignored. Written through the app's own `panelLayoutCookieName` so a
 * rename of the cookie can't quietly strand these screens on a collapsed panel.
 */
export function canvasPanels(layout: {
  sidebarPct?: number
  chatPct?: number
}): Array<{ name: string; value: string }> {
  const sidebar = layout.sidebarPct ?? 16
  const chat = layout.chatPct ?? 0
  return [
    {
      name: panelLayoutCookieName("canvas-layout"),
      value: encodeURIComponent(
        JSON.stringify({ sidebar, canvas: 100 - sidebar - chat, chat })
      ),
    },
  ]
}

/** The window every screen is shot at unless it overrides it. */
export const DEFAULT_VIEWPORT = { width: 1512, height: 982 } as const

/**
 * The desktop app's smallest window (`minWidth` in the Tauri config) — the
 * narrowest the home content ever gets once {@link narrowHome} drags the sidebar
 * to its widest.
 */
export const NARROW_HOME_VIEWPORT = { width: 900, height: 768 } as const

const ids = FIXTURE_IDS

/** The Checkout canvas's desktop frame, by its title. */
function checkoutDesktopFrame(page: Page) {
  return page.locator("[data-iframe-layer]", {
    has: page.getByText("Checkout · desktop", { exact: true }),
  })
}

export const SCREENS: Screen[] = [
  {
    name: "home-recents",
    description: "Home → Recents: the recency-ordered grid of every Canvas.",
    path: "/",
  },
  {
    name: "home-all-files",
    description:
      "Home → All files: the Folder tree's root, Folders above Canvases.",
    path: "/files",
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
    name: "home-drop-target",
    description:
      "A Canvas dragged over a Folder tile: the drop-target ring, mid-drag.",
    path: "/files",
    prepare: async (page) => {
      await dragOnto(page, "Empty canvas", "Marketing site")
    },
    settleMs: 200,
  },
  {
    name: "home-table-drop-target",
    description:
      "The same drag in the table layout: a Folder row's drop-target ring.",
    path: "/files",
    cookies: homeView("table"),
    prepare: async (page) => {
      await dragOnto(page, "Empty canvas", "Marketing site")
    },
    settleMs: 200,
  },
  {
    name: "home-recents-narrow",
    description:
      "Recents at the narrowest content width: a small window, the sidebar dragged to its widest.",
    path: "/",
    viewport: NARROW_HOME_VIEWPORT,
    cookies: narrowHome(),
  },
  {
    name: "home-folder-narrow",
    description:
      "Two Folders deep at the narrowest content width: the breadcrumb truncates, the toolbar collapses to icons.",
    path: `/files/${ids.folders.archive}`,
    viewport: NARROW_HOME_VIEWPORT,
    cookies: narrowHome(),
  },
  {
    name: "home-table-narrow",
    description:
      "The table layout at the narrowest content width, where columns give way.",
    path: "/files",
    viewport: NARROW_HOME_VIEWPORT,
    cookies: [...narrowHome(), ...homeView("table")],
  },
  {
    name: "settings-narrow",
    description: "Settings → Coding agents at the narrowest content width.",
    path: "/settings?section=coding-agents",
    viewport: NARROW_HOME_VIEWPORT,
    cookies: narrowHome(),
    fullPage: true,
  },
  {
    name: "home-focus-tile-action",
    description:
      "Keyboard focus on a Folder tile's ⋯ actions button in the home grid.",
    path: "/files",
    prepare: async (page) => {
      await tabTo(page, "Folder actions")
    },
  },
  {
    name: "home-focus-table-action",
    description:
      "Keyboard focus on a row's ⋯ actions button in the table view.",
    path: "/files",
    cookies: homeView("table"),
    prepare: async (page) => {
      await tabTo(page, "Folder actions")
    },
  },
  {
    name: "home-narrow",
    description:
      "The home grid below the md breakpoint, where there is no hover to reveal actions.",
    path: "/files",
    viewport: { width: 720, height: 900 },
  },
  {
    name: "home-breadcrumb-overflow",
    description:
      "A deep Folder, with keyboard focus on the breadcrumb's overflow menu.",
    path: `/files/${ids.folders.drafts}`,
    prepare: async (page) => {
      await tabTo(page, "Show folders in between")
    },
  },
  {
    name: "home-resize-handle-focus",
    description:
      "Keyboard focus on the handle between the sidebar and content.",
    path: "/files",
    prepare: async (page) => {
      await page.locator("[role=separator]").first().focus()
    },
  },
  {
    name: "home-move-dialog",
    description:
      "The Move to… dialog, driven by keyboard: a destination picked with the arrow keys.",
    path: "/files",
    prepare: async (page) => {
      // The menu has to animate closed for the dialog to take over.
      await unfreeze(page)
      await tabTo(page, "Folder actions")
      await page.keyboard.press("Enter")
      // Radix focuses the first item once the menu's open animation ends.
      await page.getByRole("menu").first().waitFor({ timeout: 5_000 })
      await page.waitForTimeout(500)
      // Walk down the menu to Move to…, wherever it sits in the list.
      for (let i = 0; i < 6; i++) {
        const label = await page.evaluate(
          () => document.activeElement?.textContent?.trim() ?? ""
        )
        if (label.startsWith("Move to")) break
        await page.keyboard.press("ArrowDown")
        await page.waitForTimeout(150)
      }
      await page.keyboard.press("Enter")
      // The dialog focuses its first destination as it opens.
      await page.getByRole("radiogroup").first().waitFor({ timeout: 5_000 })
      await page.keyboard.press("ArrowDown")
    },
    settleMs: 300,
  },
  {
    name: "home-move-toast",
    description:
      "The toast after dragging a Canvas into a Folder (#808): where it went, and Undo.",
    path: "/files",
    prepare: async (page) => {
      await unfreeze(page)
      await dragOnto(page, "Empty canvas", "Marketing site")
      await page.mouse.up()
      await page.mouse.move(0, 0)
      await page.waitForTimeout(1000)
    },
    settleMs: 300,
  },
  {
    name: "home-breadcrumb-drop-target",
    description:
      "A Canvas dragged over a parent Folder's breadcrumb (#808), mid-drag.",
    path: `/files/${ids.folders.archive}`,
    prepare: async (page) => {
      await dragOntoCrumb(page, "Old experiment", "Design system")
    },
    settleMs: 200,
  },
  {
    name: "home-move-dialog-new-folder",
    description:
      "The Move to… dialog naming a new Folder inside the picked destination (#808).",
    path: "/files",
    prepare: async (page) => {
      await unfreeze(page)
      await page
        .getByRole("button", { name: "Folder actions" })
        .first()
        .click({ timeout: 15_000 })
      await page.getByRole("menuitem", { name: /^Move to/ }).click()
      await page.getByRole("radiogroup").first().waitFor({ timeout: 5_000 })
      await page.getByRole("radio", { name: "Marketing site" }).click()
      await page.getByRole("button", { name: "New folder" }).click()
      await page.keyboard.type("Launch week")
      await page.waitForTimeout(300)
    },
    settleMs: 300,
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
    name: "home-search-empty",
    description: "A search that matches nothing: the popover says so.",
    path: "/files",
    prepare: async (page) => {
      await searchHome(page, "zzz")
    },
  },
  {
    name: "home-search-narrow",
    description:
      "Search at the narrowest content width, over the table layout.",
    path: "/files",
    viewport: NARROW_HOME_VIEWPORT,
    cookies: [...narrowHome(), ...homeView("table")],
    prepare: async (page) => {
      await searchHome(page, "exp")
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
      "Settings → Coding agents: the default agent and one row per CLI.",
    path: "/settings?section=coding-agents",
    fullPage: true,
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
    name: "canvas-loading",
    description:
      "The Canvas route's loading skeleton, held on screen by a silent Yjs socket.",
    path: `/${ids.rooms.checkout}`,
    beforeNavigate: holdYjsConnection,
  },
  {
    name: "canvas-not-found",
    description: "A Canvas id that doesn't exist — the Canvas not-found page.",
    path: `/${ids.missingRoom}`,
  },
  {
    name: "canvas-error",
    description:
      "The Canvas route's error page, reached by making the Canvas throw on mount.",
    path: `/${ids.rooms.checkout}`,
    beforeNavigate: breakCanvasMount,
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
    name: "chat-coordinator-answer",
    description:
      'The Coordinator answering "What\'s on this canvas?" from its read-canvas tool (#893).',
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
      await replayRun(page, roomChatId(ids.rooms.checkout), coordinatorRun())
    },
    settleMs: 400,
  },
  {
    name: "chat-coordinator-undo",
    description:
      "The Coordinator removing a frame and a document, then undoing it when asked, with both turns' steps open (#894).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
      await replayRun(
        page,
        roomChatId(ids.rooms.checkout),
        coordinatorUndoRun()
      )
      await expandTurnSummaries(page)
    },
    settleMs: 400,
  },
  {
    name: "chat-coordinator-tasks",
    description:
      "The Coordinator's task rows after it messaged two Workspaces: one working, one waiting on a plan (#896).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
      await replayRun(page, roomChatId(ids.rooms.checkout), delegationRun())
      // Checkout polish's turn is under way; Empty cart state's plan waits.
      await replayRun(page, ids.chats.checkoutPolish, [
        { type: "chat-stream-start" },
      ])
      await page
        .getByTestId("workspace-task")
        .first()
        .waitFor({ timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "chat-coordinator-tasks-done",
    description:
      "The same task rows once Checkout polish's turn ended: Done, with its changed lines (#896).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
      await replayRun(page, roomChatId(ids.rooms.checkout), delegationRun())
      await page
        .getByTestId("workspace-task")
        .first()
        .waitFor({ timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "chat-delegated-message",
    description:
      'A Workspace chat the Coordinator messaged: the collapsed "Received a message from the Coordinator" row, then the agent\'s reply (#896).',
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, delegatedWorkspaceRun())
    },
    settleMs: 400,
  },
  {
    name: "chat-delegated-message-open",
    description:
      "The Delegated Message row opened to the Coordinator's message (#896).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, delegatedWorkspaceRun())
      await page
        .getByRole("button", {
          name: "Received a message from the Coordinator",
        })
        .first()
        .click({ timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "chat-coordinator-breadcrumb",
    description:
      "A Workspace's chat header: the Coordinator crumb before the Workspace pill, hovered (#893).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "Checkout polish")
      await page
        .getByRole("button", { name: "Coordinator", exact: true })
        .hover({ timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "chat-header-workspace-picker",
    description:
      "A Workspace's chat header with its Workspace picker open: each row a state icon, the plain name and the PR badge or line count (#974).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await selectWorkspace(page, "Checkout polish")
      await page
        .locator("[data-slot=tabs]")
        .locator("button:has(svg.lucide-chevrons-up-down)")
        .first()
        .click({ timeout: 15_000 })
      await page
        .getByPlaceholder("Search workspaces and layers…")
        .waitFor({ state: "visible", timeout: 15_000 })
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
  {
    name: "terminal",
    description:
      "A terminal tab running a test and printing all 16 ANSI colours.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: stubTerminal,
    prepare: openTerminalTab,
    settleMs: 600,
  },
  {
    name: "terminal-tabs-restored",
    description:
      "A cold room load with the Workspace's two saved terminal tabs still in its tab strip.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: stubTerminal,
    prepare: (page) => selectWorkspace(page, "Checkout polish"),
    settleMs: 600,
  },
  {
    name: "terminal-tab-rename",
    description:
      "A restored terminal tab's label in rename mode, in the same sans as chat tabs (#918).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: stubTerminal,
    prepare: async (page) => {
      await selectWorkspace(page, "checkout-polish")
      await page
        .getByRole("tab")
        .getByText("claude", { exact: true })
        .dblclick({ timeout: 15_000 })
    },
    settleMs: 600,
  },
  {
    name: "chat-tabs-unread",
    description:
      "A background chat whose run just finished, marked unread in the tab strip.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "Checkout polish")
      await replayRun(page, ids.chats.markdown, [
        { type: "chat-stream-start" },
        { type: "chat-stream-end" },
      ])
    },
    settleMs: 400,
  },
  {
    name: "chat-history",
    description:
      "The chat history: closed chats with dates, first lines, one still running.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "Checkout polish")
      await replayRun(page, ids.chats.stickySummary, [
        { type: "chat-stream-start" },
      ])
      await openChatHistory(page)
    },
    settleMs: 600,
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
  {
    name: "canvas-selection",
    description:
      "Canvas selection chrome: a selected frame plus a selected Group, with the union rect and fuchsia titles.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page
        .getByText("Checkout · desktop", { exact: true })
        .first()
        .click({ timeout: 15_000 })
      await page
        .getByText("Cart", { exact: true })
        .first()
        .click({ modifiers: ["Shift"], timeout: 15_000 })
      await page.mouse.move(1180, 640)
    },
  },
  {
    name: "canvas-presence",
    description:
      "Remote cursors on light presence colours: one under the bottom toolbar, one mid cursor-chat.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      // A pointer over a toolbar isn't published (the pills swallow it), so a
      // remote cursor only lands under *our* toolbar when the peer's window is
      // shaped differently. The first peer is taller, so the same world point
      // is open canvas for them and toolbar for us.
      await addPeer(page, {
        paletteIndex: 3,
        at: { x: 866, y: 944 },
        viewport: { width: 1512, height: 1240 },
      })
      await addPeer(page, {
        paletteIndex: 5,
        at: { x: 300, y: 420 },
        message: "Can we tighten this?",
      })
      await page.waitForTimeout(800)
    },
  },
  {
    name: "canvas-chat-empty",
    description: "A frame chat with nothing sent yet: the empty state.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-off-default",
    description:
      "A new chat switched off the default model: the composer says so.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await page.getByRole("button", { name: /^Claude Code · / }).click()
      await page.getByRole("menuitem", { name: "Sonnet 5" }).click()
      await page.getByText("· not default").waitFor()
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-empty-document",
    description: "A Document chat with nothing sent yet: the empty state.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await selectChatTarget(page, "Checkout brief")
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-loading",
    description: "A chat while its history is still loading.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      // History loads once, on mount, so hold the request open and reload.
      await page.route("**/api/agent/history**", () => {})
      await page.reload()
      await page.waitForTimeout(1500)
    },
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
    name: "canvas-chat-stopped",
    description: "A run the user stopped part-way through.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, [
        ...streamingRun(),
        { type: "chat-control", control: { kind: "stopped" } },
        { type: "chat-stream-end" },
      ])
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-stop-failed",
    description: "A run whose Stop request failed.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page.route("**/api/agent/stop", (route) =>
        route.fulfill({ status: 500, body: "The run didn't respond" })
      )
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, streamingRun())
      await page
        .locator('[title="Stop"], [aria-label="Stop"]')
        .first()
        .click({ timeout: 10_000 })
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-composer-draft",
    description: "A frame chat with a draft typed into the composer.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await typeInComposer(page, "Make the order summary sticky on mobile")
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-draft-reload",
    description:
      "A draft typed into a chat, after the page reloads: what's left in the composer.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await typeInComposer(page, "Make the order summary sticky on mobile")
      await page.waitForTimeout(300)
      await page.reload()
      await openChatTab(page, "New chat")
    },
    settleMs: 600,
  },
  {
    name: "canvas-chat-send-failed",
    description: "A message the server refused: what's left of it in the chat.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page.route("**/api/agent/stream", (route) =>
        route.fulfill({ status: 503, body: "The agent couldn't be reached" })
      )
      await openChatTab(page, "New chat")
      await typeInComposer(page, "Make the order summary sticky on mobile")
      await page.keyboard.press("Enter")
    },
    settleMs: 600,
  },
  {
    name: "canvas-chat-queued",
    description: "A message sent with Enter while the agent is still running.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, streamingRun())
      await typeInComposer(page, "Then do the same for the cart page")
      await page.keyboard.press("Enter")
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-image-paste",
    description: "An image pasted into the composer.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await typeInComposer(page, "Match this layout ")
      await pasteImageInComposer(page)
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-tool-states",
    description:
      "Every tool-call state: running, done, failed with and without a reason, an expanded edit diff, and a long transcript error.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, toolStatesRun())
      await expandTurnSummaries(page)
      await expandToolCall(page, /^Edit/)
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-tool-hover",
    description:
      "A tool call whose path is too long for the row, hovered to read it in full.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, toolStatesRun())
      await expandTurnSummaries(page)
      // Hover the row, not the path text: hovering the text scrolls the
      // clipped title sideways to bring it into view.
      await page
        .getByRole("button", { name: /^Read 3 lines/ })
        .first()
        .hover({ timeout: 10_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-disclosure-focus",
    description:
      "A collapsible chat section (reasoning) reached from the keyboard, showing its focus ring.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "Checkout polish")
      await expandTurnSummaries(page)
      // Reach it with the keyboard (focus back, then Tab onto it) so the
      // browser treats the focus as keyboard focus and paints the ring.
      await page
        .getByRole("button", { name: /^Reasoning$/ })
        .first()
        .focus({ timeout: 15_000 })
      await page.keyboard.press("Shift+Tab")
      await page.keyboard.press("Tab")
    },
    settleMs: 400,
  },
  {
    name: "canvas-setup-error",
    description:
      "A Workspace's setup error opened from the sidebar, as a keyboard user reaches it.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await openSetupError(page)
    },
    settleMs: 300,
  },
  {
    name: "canvas-workspace-status",
    description:
      "Hovering a Workspace row that's still setting up: its hover card names the step (#882).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page
        .getByRole("img", { name: "Running setup script" })
        .hover({ timeout: 15_000 })
      await waitForWorkspaceHoverCard(page)
    },
    settleMs: 300,
  },
  {
    name: "canvas-workspace-hover-card",
    description:
      "Hovering a Workspace row: title, status, repository, git branch, base and changes (#882).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page
        .locator("[data-sidebar=menu-button]", {
          hasText: "Checkout polish",
        })
        .first()
        .hover({ timeout: 15_000 })
      await waitForWorkspaceHoverCard(page)
    },
    settleMs: 300,
  },
  {
    name: "canvas-workspace-hover-card-group",
    description:
      "Hovering a group label's Workspace pill: the same hover card as the row (#882).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page
        // The Cart group label's pill, not the sidebar group row's. The
        // Checkout group's label sits under the top chrome at this viewport.
        .locator("[data-slot=badge]:not([data-slot=sidebar-menu-button] *)", {
          hasText: "Empty cart state",
        })
        .first()
        .hover({ timeout: 15_000 })
      await waitForWorkspaceHoverCard(page)
    },
    settleMs: 300,
  },
  {
    name: "canvas-workspace-hover-card-pill",
    description:
      "Hovering the Workspace in a selected frame's address bar: the same hover card as the row (#882).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await selectCheckoutFrame(page)
      await page
        .getByRole("button", { name: /^Workspace: / })
        .first()
        .hover({ timeout: 15_000 })
      await waitForWorkspaceHoverCard(page)
    },
    settleMs: 300,
  },
  {
    name: "canvas-workspaces-two-repos",
    description:
      "The sidebar's Workspaces list on a canvas with two repositories: each row ends with its repository (#884).",
    path: `/${ids.rooms.pricing}`,
  },
  {
    name: "canvas-pr-merged",
    description:
      "A Canvas whose Workspace has a merged PR and an agent turn in flight: the activity spinner up front, the merged PR at the row's end (#963).",
    path: `/${ids.rooms.pricing}`,
  },
  {
    name: "canvas-pr-closed",
    description:
      "A Canvas with a stopped Workspace (a dashed circle, its closed PR not shown) and one still being created.",
    path: `/${ids.rooms.onboarding}`,
  },
  {
    name: "canvas-frame-toolbar",
    description:
      "A selected frame's floating toolbar, hovering its first button to show the tooltip.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await selectCheckoutFrame(page)
      // Positional, not by name, so the same step shoots a branch whose
      // buttons have no accessible name yet.
      await page
        .locator("#frame-toolbar-portal button")
        .first()
        .hover({ timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "canvas-frame-interacting",
    description:
      "Double-clicking a frame's body: the frame enters interaction, with its ring and the toolbar's Interact button pressed, hovered for its tooltip with the Esc key.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      const frame = checkoutDesktopFrame(page)
      await frame.waitFor({ state: "visible", timeout: 15_000 })
      await frame.dblclick({ timeout: 15_000 })
      await page
        .locator("#frame-toolbar-portal")
        .getByRole("button", { name: "Interact" })
        .hover({ timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "canvas-frame-interact-escape",
    description:
      "Interacting with a frame, clicking into the preview, then pressing Esc: the frame is back on the canvas, still selected.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      const frame = checkoutDesktopFrame(page)
      await frame.waitFor({ state: "visible", timeout: 15_000 })
      await frame.click({ timeout: 15_000 })
      await page
        .locator("#frame-toolbar-portal button")
        .first()
        .click({ timeout: 15_000 })
      // Focus now lives inside the preview's iframe, where the canvas's own
      // keydown listener can't hear it.
      await frame.click({ timeout: 15_000 })
      await page.keyboard.press("Escape")
      // Park the pointer on empty canvas so no hover outline lingers.
      await page.mouse.move(5, 5)
    },
    settleMs: 400,
  },
  {
    name: "canvas-frame-toolbar-menu",
    description:
      "A selected frame's toolbar with its … menu open: frame actions and the Workspace submenu.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await selectCheckoutFrame(page)
      // The menu trigger is the toolbar's last button, before and after #796.
      await page
        .locator("#frame-toolbar-portal button")
        .last()
        .click({ timeout: 15_000 })
      await page
        .getByRole("menu")
        .first()
        .waitFor({ state: "visible", timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "canvas-frame-route-field",
    description:
      "A selected frame's toolbar route field pressed, with a route typed: the discovered routes and Go to.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await selectCheckoutFrame(page)
      await page
        .locator("#frame-toolbar-portal")
        .getByRole("button", { name: /^Route:/ })
        .click({ timeout: 15_000 })
      await page.keyboard.type("/ca")
    },
    settleMs: 400,
  },
  {
    name: "canvas-frame-workspace-host",
    description:
      "A selected frame's address field naming its Workspace before the route, like a browser's host.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await selectCheckoutFrame(page)
      // Park the pointer on empty canvas so no hover state lingers.
      await page.mouse.move(5, 5)
    },
    settleMs: 400,
  },
  {
    name: "canvas-frame-workspace-switcher",
    description:
      "A selected frame's Workspace list, opened from its address field's host (from the label's Workspace stub before #867).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await selectCheckoutFrame(page)
      const host = page
        .locator("#frame-toolbar-portal")
        .getByRole("button", { name: /^Workspace:/ })
      if ((await host.count()) > 0) {
        await host.click({ timeout: 15_000 })
      } else {
        await page
          .locator("button:has(svg.lucide-chevrons-up-down)")
          .filter({ hasText: "Checkout polish" })
          .first()
          .click({ timeout: 15_000 })
      }
      await page
        .getByPlaceholder("Search workspaces…")
        .waitFor({ state: "visible", timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "canvas-frame-back",
    description:
      "A frame navigated from its toolbar's route field, hovering Back: the history button enabled with its tooltip.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await selectCheckoutFrame(page)
      const toolbar = page.locator("#frame-toolbar-portal")
      const field = toolbar.getByRole("button", { name: /^Route:/ })
      // Themes share the Canvas, so the frame may already be on /cart from
      // the other theme's run; go wherever it isn't.
      const onCart = (await field.getAttribute("aria-label")) === "Route: /cart"
      await field.click({ timeout: 15_000 })
      await page.keyboard.type(onCart ? "/checkout" : "/cart")
      await page.keyboard.press("Enter")
      // Wait out the route popover's exit and the history update, so the
      // hover lands on an enabled Back button.
      await page
        .locator("[data-slot=popover-content]")
        .waitFor({ state: "detached", timeout: 15_000 })
      const back = toolbar.locator('button[aria-label="Back"]:not([disabled])')
      await back.waitFor({ timeout: 15_000 })
      await back.hover({ timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 1500,
  },
  {
    name: "canvas-frame-recording",
    description:
      "A frame recording a flow from its address field: the field red with its screen count and a stop button, a screen left behind for the page it moved from.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await selectCheckoutFrame(page)
      const toolbar = page.locator("#frame-toolbar-portal")
      await toolbar
        .getByRole("button", { name: "Record flow" })
        .click({ timeout: 15_000 })
      // Themes share the Canvas, so the frame may already be on /cart from
      // the other theme's run; go wherever it isn't.
      const field = toolbar.getByRole("button", { name: /^Route:/ })
      const onCart = (await field.getAttribute("aria-label")) === "Route: /cart"
      await field.click({ timeout: 15_000 })
      await page.keyboard.type(onCart ? "/checkout" : "/cart")
      await page.keyboard.press("Enter")
      await page
        .locator("[data-slot=popover-content]")
        .waitFor({ state: "detached", timeout: 15_000 })
      await toolbar.getByText(/· 2 screens/).waitFor({ timeout: 15_000 })
      await toolbar
        .getByRole("button", { name: "Stop recording" })
        .hover({ timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 1500,
  },
  {
    name: "canvas-frame-knobs-empty",
    description:
      "A selected frame's Knobs popover for a prototype with no knobs yet.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await selectCheckoutFrame(page)
      await page
        .locator("#frame-toolbar-portal")
        .getByRole("button", { name: "Knobs" })
        .click({ timeout: 15_000 })
      await page
        .getByText("No knobs yet")
        .waitFor({ state: "visible", timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "canvas-document-format-toolbar",
    description:
      "A Document being edited with a word selected: the formatting toolbar, hovering Bold to show its tooltip.",
    path: `/${ids.rooms.tokens}`,
    prepare: async (page) => {
      // The prose is under the Document's drag overlay until editing starts,
      // so aim at its box rather than the element itself. A line partway down
      // keeps the toolbar clear of the top bar.
      const line = page.getByText("is the only secondary text color", {
        exact: false,
      })
      await line.first().waitFor({ state: "visible", timeout: 15_000 })
      const box = await line.first().boundingBox()
      if (!box) throw new Error("line has no box")
      await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
      await page
        .locator('[data-markdown-layer] [contenteditable="true"]')
        .first()
        .waitFor({ state: "visible", timeout: 15_000 })
      await page.keyboard.press("End")
      await page.keyboard.press("Shift+Home")
      const bold = page
        .locator("#inline-comment-bubble-portal")
        .getByRole("button", { name: "Bold" })
      await bold.waitFor({ state: "visible", timeout: 15_000 })
      await bold.hover({ timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "canvas-room-menu-hover",
    description:
      "Hovering the top bar's Canvas options (…) button beside the Canvas name.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page
        .locator('[data-slot="breadcrumb-item"] button')
        .first()
        .hover({ timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "sidebar-collapse-hover",
    description: "Hovering the sidebar's collapse button.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page
        .locator("button:has(svg.lucide-panel-left-close)")
        .first()
        .hover({ timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "sidebar-project-row-hover",
    description:
      "Hovering the sidebar's New workspace (+) button, with its tooltip.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await newWorkspaceButton(page).then((b) => b.hover())
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "sidebar-workspace-menu-hover",
    description: "Hovering a Workspace row's overflow (…) button.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      const row = page
        .locator(".group\\/branch-row")
        .filter({ hasText: "Checkout polish" })
        .first()
      await row.hover()
      await row
        .locator('[aria-haspopup="menu"]')
        .first()
        .hover({ timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "sidebar-workspace-menu-open-pr",
    description:
      "The Workspace row's … menu open on a Workspace with an open PR.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await openBranchRowMenu(page, "Checkout polish")
    },
    settleMs: 400,
  },
  {
    name: "sidebar-workspace-rename-title",
    description:
      "Renaming a Workspace's title by double-clicking its sidebar row (#881). The branch is untouched.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      // Light and dark share the Canvas, and the first run's rename commits
      // on close, so find the row by either name.
      await page
        .locator(".group\\/branch-row")
        .getByText(/^(Empty cart state|Empty cart illustration)$/)
        .first()
        .dblclick({ timeout: 15_000 })
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
    name: "sidebar-workspace-menu-changes",
    description:
      "The Workspace row's … menu open on a Workspace with changes and no PR.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await openBranchRowMenu(page, "Empty cart state")
    },
    settleMs: 400,
  },
  {
    name: "sidebar-workspace-menu-starting",
    description:
      "The Workspace row's … menu open on a Workspace still running setup.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await openBranchRowMenu(page, "Apple Pay button")
    },
    settleMs: 400,
  },
  {
    name: "sidebar-workspace-menu-failed",
    description:
      "The Workspace row's … menu open on a Workspace whose setup failed.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await openBranchRowMenu(page, "gift-cards")
    },
    settleMs: 400,
  },
  {
    name: "sidebar-layer-menu-hover",
    description: "Hovering a Layer row's overflow (…) button in the sidebar.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      const row = page.locator(".group\\/frame-row").first()
      await row.hover()
      await row
        .locator('[aria-haspopup="menu"]')
        .first()
        .hover({ timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "sidebar-workspace-hover-frames",
    description:
      "Hovering a Workspace row: its frames are outlined on the Canvas and lit in the layer list (#793).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await hoverWorkspaceRow(page, "Checkout polish")
    },
    settleMs: 300,
  },
  {
    name: "sidebar-frame-row-hover-workspace",
    description:
      "Hovering a frame row in the layer list: its Workspace row lights up (#793).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page
        .locator(".group\\/frame-row")
        .filter({ hasText: "Empty cart" })
        .first()
        .hover({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "canvas-frame-hover-workspace",
    description:
      "Hovering a frame on the Canvas: its Workspace row lights up in the sidebar (#793).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      const frame = checkoutDesktopFrame(page)
      await frame.waitFor({ state: "visible", timeout: 15_000 })
      await frame.hover({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "sidebar-workspace-hover-groups",
    description:
      "Hovering a Workspace row lights up the Groups on it and their following frames; frames of those Groups on other Workspaces stay unlit (#872).",
    path: `/${ids.rooms.frameStates}`,
    prepare: async (page) => {
      await hoverWorkspaceRow(page, "search-filters")
    },
    settleMs: 300,
  },
  {
    name: "sidebar-workspace-hover-exception",
    description:
      "Hovering the Workspace of an exception frame: that frame lights up, its Group (on another Workspace) doesn't (#872).",
    path: `/${ids.rooms.frameStates}`,
    prepare: async (page) => {
      await hoverWorkspaceRow(page, "saved-searches")
    },
    settleMs: 300,
  },
  {
    name: "sidebar-group-row-hover-workspace",
    description:
      "Hovering a Group row in the layer list: its Workspace row lights up (#872).",
    path: `/${ids.rooms.frameStates}`,
    prepare: async (page) => {
      await page
        .locator(".group\\/frame-group-row")
        .filter({ hasText: "Progress" })
        .first()
        .hover({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "canvas-group-pill-hover-workspace",
    description:
      "Hovering the Workspace pill on a Group's label on the Canvas: its Workspace row lights up (#872).",
    path: `/${ids.rooms.frameStates}`,
    prepare: async (page) => {
      await page
        .locator('[data-slot="group-workspace"]')
        .filter({ hasText: "search-filters" })
        .first()
        .hover({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "chat-tab-close-focus",
    description:
      "The active chat tab's close button reached by keyboard (focus the tab, then Tab past its label).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "Checkout polish")
      await page
        .getByRole("tab", { name: /Checkout polish/i })
        .first()
        .focus()
      // Park the pointer off the strip, so only focus can reveal the close.
      await page.mouse.move(0, 0)
      // The tab's rename label is the first stop after it, the close the next.
      await page.keyboard.press("Tab")
      await page.keyboard.press("Tab")
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "chat-new-chat-hover",
    description: "Hovering the chat tab strip's New chat (+) button.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await selectWorkspace(page, CHAT_WORKSPACE)
      await page
        .locator('[data-slot="tabs-list"] button:has(svg.lucide-plus)')
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
    name: "composer-model-locked-hover",
    description:
      "Hovering the model picker of a chat that has started, where the model is locked.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "Checkout polish")
      // force: the locked picker is disabled, so it takes no pointer events of
      // its own; hovering its box is what a person does.
      await page
        .locator(
          '[data-slot="input-group"] button:has(svg.lucide-chevron-down)'
        )
        .filter({ visible: true })
        .last()
        .hover({ force: true, timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "player-hud-hover",
    description: "The prototype player's HUD, hovering the knobs button.",
    path: `/play/${ids.rooms.checkout}/${ids.branches.checkoutPolish}`,
    prepare: async (page) => {
      await page
        .locator("button:has(svg.lucide-sliders-horizontal)")
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
  {
    name: "canvas-getting-started",
    description:
      "The first Canvas after setup: the getting-started checklist on Add a project.",
    path: `/${ids.rooms.empty}`,
    beforeNavigate: (page) => markGettingStarted(page, ids.rooms.empty),
    settleMs: 400,
  },
  {
    name: "canvas-getting-started-workspace",
    description:
      "The getting-started checklist once a Project is added with no Workspace.",
    path: `/${ids.rooms.empty}`,
    beforeNavigate: async (page) => {
      await markGettingStarted(page, ids.rooms.empty)
      await serveYjsDoc(page, (c) =>
        c.repos.set(gettingStartedRepo.id, gettingStartedRepo)
      )
    },
    settleMs: 400,
  },
  {
    name: "canvas-getting-started-frame",
    description:
      "The getting-started checklist in the corner while the first Workspace starts.",
    path: `/${ids.rooms.empty}`,
    beforeNavigate: async (page) => {
      await markGettingStarted(page, ids.rooms.empty)
      await serveYjsDoc(page, (c) => {
        c.repos.set(gettingStartedRepo.id, gettingStartedRepo)
        c.branches.set("branch-first", {
          id: "branch-first",
          repoId: gettingStartedRepo.id,
          sandboxName: `${COLD_WORKSPACE_PREFIX}first`,
          gitUrl: gettingStartedRepo.cloneUrl,
          ref: "quiet-harbor",
          previewDomain: "",
          port: 3000,
          status: "starting",
          statusMessage: "Installing dependencies…",
          createdAt: Date.now() - 40_000,
          colorIndex: 0,
          sidebarOrder: 0,
        })
        c.iframeLayers.set("layer-first", {
          id: "layer-first",
          branchId: "branch-first",
          width: 1280,
          height: 800,
          label: "storefront",
          iframeState: {},
          route: "/",
        })
        c.iframeLayerGroups.set("grp-first", {
          id: "grp-first",
          x: 0,
          y: 0,
          members: [{ kind: "iframe-layer", id: "layer-first" }],
          sidebarOrder: 0,
        })
        c.savedViewport.set({ x: 180, y: 140, zoom: 0.55 })
      })
    },
    settleMs: 400,
  },
  {
    name: "canvas-getting-started-done",
    description:
      "The getting-started checklist with every step done, on a Canvas with a running frame.",
    path: `/${ids.rooms.frameStates}`,
    beforeNavigate: (page) => markGettingStarted(page, ids.rooms.frameStates),
    settleMs: 400,
  },
  {
    name: "canvas-sidebar-no-projects",
    description:
      "The sidebar's Workspaces section on a Canvas with no repository: why, and Add repository (#884).",
    path: `/${ids.rooms.tokens}`,
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "Add repository", exact: true })
        .first()
        .waitFor({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "canvas-chat-no-projects",
    description:
      "The chat panel's empty state on a Canvas with no Project attached.",
    path: `/${ids.rooms.tokens}`,
    cookies: canvasPanels({ chatPct: 30 }),
    settleMs: 400,
  },
  {
    name: "chat-target-picker",
    description: "The chat panel's target picker: Workspaces and Documents.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await selectWorkspace(page, CHAT_WORKSPACE)
      // The chat header's trigger is labelled with the current Workspace's
      // ref; the frame labels on the canvas share that shape and come first.
      await page
        .locator("button:has(svg.lucide-chevrons-up-down)")
        .filter({ hasText: "Checkout polish" })
        .last()
        .click({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "frame-workspace-picker",
    description:
      "An unbound frame's Workspace picker, opened from its label on the canvas.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      // Matches the copy on both sides of the #723 rename so a before/after
      // pair shoots the same state.
      await page
        .getByRole("button", { name: /^Choose a (branch|workspace)$/ })
        .first()
        .click({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "dialog-new-workspace",
    description:
      "The prompt-first Create workspaces dialog, from the sidebar's New workspace (+).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await newWorkspaceButton(page).then((b) => b.click())
    },
    settleMs: 400,
  },
  {
    name: "dialog-new-workspace-two-repos",
    description:
      "Create workspaces on a canvas with two repositories: a repository chip beside each row's base branch (#884).",
    path: `/${ids.rooms.pricing}`,
    prepare: async (page) => {
      await newWorkspaceButton(page).then((b) => b.click())
      await page.getByRole("dialog").waitFor({ timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "add-project-github",
    description:
      "Add repository → Open GitHub repository: presets named once over the signed-in account's repos.",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureGitHub(),
    prepare: async (page) => {
      await openAddProject(page, "github")
      await page.getByText("acme/docs").first().waitFor({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "add-project-github-loading",
    description: "Open GitHub repository while the repo list is still loading.",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureGitHub(),
    prepare: async (page) => {
      await holdServerActions(page, "hang")
      await openAddProject(page, "github")
      await page.waitForTimeout(500)
    },
    settleMs: 300,
  },
  {
    name: "add-project-github-error",
    description: "Open GitHub repository after the repo list fails to load.",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureGitHub(),
    prepare: async (page) => {
      await holdServerActions(page, "fail")
      await openAddProject(page, "github")
      await page.getByText(/Couldn.t load your GitHub/).waitFor({
        timeout: 15_000,
      })
    },
    settleMs: 300,
  },
  {
    name: "add-project-github-disconnected",
    description:
      "Open GitHub repository with no GitHub connection on this device.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await openAddProject(page, "github")
      await page
        .getByText("Connect GitHub to see your repositories here.")
        .waitFor({
          timeout: 15_000,
        })
    },
    settleMs: 300,
  },
  {
    name: "add-project-folder-error",
    description:
      "Add repository → Open folder on a folder that isn't a git checkout: the path stays, with why.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      const { plain } = fixtureCheckouts()
      await openAddProject(page, "folder")
      await page.getByPlaceholder("/path/to/your/clone").fill(plain)
      await page.getByRole("button", { name: "Add", exact: true }).click()
      await page.getByText("Not a git repository").waitFor({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "add-project-settings",
    description:
      "Configure repository for a folder, with Back to the folder it came from.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await addFixtureFolder(page)
    },
    settleMs: 300,
  },
  {
    name: "add-project-settings-model",
    description:
      "Configure repository after a model read the folder's files: the README's one-time codegen step joins the install.",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureModel("connected"),
    prepare: async (page) => {
      await addFixtureFolder(page)
    },
    settleMs: 300,
  },
  {
    name: "add-project-settings-model-detecting",
    description:
      "Configure repository while the model reads the folder, the rule-based guess already filled in.",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureModel("slow"),
    prepare: async (page) => {
      const { checkout } = fixtureCheckouts()
      await openAddProject(page, "folder")
      await page.getByPlaceholder("/path/to/your/clone").fill(checkout)
      await page.getByRole("button", { name: "Add", exact: true }).click()
      await page.getByText("Configure repository").waitFor({ timeout: 15_000 })
      // The rule-based pass has filled the form; the model is still reading.
      await page.waitForFunction(
        () =>
          (document.getElementById("repo-add-setup") as HTMLInputElement | null)
            ?.value === "pnpm install",
        undefined,
        { timeout: 15_000 }
      )
    },
    settleMs: 300,
  },
  {
    name: "add-project-settings-github",
    description:
      "Configure repository for a GitHub repo, with Back to the list it came from.",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureGitHub(),
    prepare: async (page) => {
      await openAddProject(page, "github")
      await page.getByText("acme/docs").first().click({ timeout: 15_000 })
      await page.getByText(/Couldn.t auto-detect/).waitFor({ timeout: 15_000 })
    },
    settleMs: 300,
  },
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
  {
    name: "player",
    description: "The prototype player for a running Workspace.",
    path: `/play/${ids.rooms.checkout}/${ids.branches.checkoutPolish}`,
  },
  {
    name: "player-agent",
    description:
      "The prototype player with the agent open beside it, composer in view.",
    path: `/play/${ids.rooms.checkout}/${ids.branches.checkoutPolish}`,
    prepare: openPlayerAgent,
    settleMs: 600,
  },
  {
    name: "player-chat-warming-up",
    description:
      "The player's agent panel while the Workspace's sandbox is still warming up.",
    path: `/play/${ids.rooms.checkout}/${ids.branches.checkoutPolish}`,
    beforeNavigate: (page) =>
      serveYjsDoc(page, (c) =>
        c.branches.set(ids.branches.checkoutPolish, {
          id: ids.branches.checkoutPolish,
          repoId: "repo-warming-up",
          sandboxName: "",
          gitUrl: "",
          ref: "checkout-polish",
          previewDomain: "",
          port: 3000,
          status: "creating",
          createdAt: 0,
        })
      ),
    prepare: openPlayerAgent,
    settleMs: 400,
  },
  {
    name: "player-chat-not-found",
    description:
      "The player's agent panel once its Workspace has been deleted from the Canvas.",
    path: `/play/${ids.rooms.checkout}/${ids.branches.checkoutPolish}`,
    beforeNavigate: (page) => serveYjsDoc(page, () => {}),
    prepare: openPlayerAgent,
    settleMs: 400,
  },

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
    name: "confirm-delete-frame",
    description: "Canvas sidebar → a frame's … menu → Delete.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      // Frozen so a build without the confirm (the "before" half) deletes on
      // screen only, never in the persisted world.
      await freezeYjs(page)
      await chooseFromMenu(page, rowMenuTrigger(page, "Empty cart"), ["Delete"])
    },
    settleMs: 300,
  },
  {
    name: "confirm-delete-group",
    description: "Canvas sidebar → a Group's … menu → Delete.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      // Frozen so a build without the confirm (the "before" half) deletes on
      // screen only, never in the persisted world.
      await freezeYjs(page)
      await chooseFromMenu(page, rowMenuTrigger(page, "Checkout"), ["Delete"])
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
  {
    name: "canvas-frame-states",
    description:
      "A frame in every Workspace stage: booting, starting, ready, failed, stopped, and no Workspace.",
    path: `/${ids.rooms.frameStates}`,
    // Long enough for the ready frame's page to paint and the probe of the
    // cold ones to settle on "not ready".
    settleMs: 2500,
  },
  {
    name: "canvas-frame-follow-group",
    description:
      "An exception frame's Workspace list, opened from the pill on its label: Follow <Group> leads, then the Workspaces for this frame only (#868).",
    path: `/${ids.rooms.frameStates}`,
    prepare: async (page) => {
      // "Starting" is on saved-searches; its Group, Progress, is on
      // search-filters.
      await page
        .getByRole("button", { name: "Workspace: saved-searches" })
        .first()
        .click({ timeout: 15_000 })
      await page
        .getByPlaceholder("Search workspaces…")
        .waitFor({ state: "visible", timeout: 15_000 })
    },
    settleMs: 800,
  },
  {
    name: "canvas-group-workspace-hover",
    description:
      "Hovering a Group's Workspace pill on its group label: the up-down chevron shows that it switches the whole Group (#869).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      // Frames that follow their Group name no Workspace, so the only canvas
      // label carrying Empty cart state is the Cart group's. (Checkout's label
      // sits under the top chrome at this viewport.)
      await page
        .locator(".canvas-frame-label")
        .getByText("Empty cart state")
        .first()
        .hover({ timeout: 15_000 })
    },
    settleMs: 600,
  },
  {
    name: "canvas-group-workspace-switcher",
    description:
      "A Group's Workspace list, opened from the pill on its group label: Show <Group> from…, and a footer saying how many frames move (#869).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^Show Cart from another workspace/ })
        .click({ timeout: 15_000 })
      await page
        .getByPlaceholder("Show Cart from…")
        .waitFor({ state: "visible", timeout: 15_000 })
    },
    settleMs: 800,
  },
  {
    name: "canvas-group-workspace-exceptions",
    description:
      "A Group switcher whose Group has exceptions: the footer names the frames that stay on their own Workspaces (#869).",
    path: `/${ids.rooms.frameStates}`,
    prepare: async (page) => {
      // Progress is on search-filters; Starting and Ready are exceptions.
      await page
        .getByRole("button", { name: /^Show Progress from another workspace/ })
        .click({ timeout: 15_000 })
      await page
        .getByPlaceholder("Show Progress from…")
        .waitFor({ state: "visible", timeout: 15_000 })
    },
    settleMs: 800,
  },
  ...(
    [
      ["booting", "framesBooting", "Booting"],
      ["starting", "framesStarting", "Starting"],
      ["failed", "framesFailed", "Failed"],
      ["stopped", "framesStopped", "Stopped"],
    ] as const
  ).map(
    ([stage, branch, label]): Screen => ({
      name: `play-${stage}`,
      description: `The prototype player on a Workspace that is ${label.toLowerCase()}.`,
      path: playPath(ids.branches[branch], `layer-frames-${stage}`),
      settleMs: 2500,
    })
  ),
  {
    name: "canvas-frame-open-logs",
    description:
      "A failed frame's Open logs: the chat panel opens on that Workspace's sandbox logs.",
    path: `/${ids.rooms.frameStates}`,
    beforeNavigate: (page) => stubLogs(page, "reconnecting"),
    prepare: async (page) => {
      await page
        .locator('[data-frame-stage="workspace-failed"]')
        .getByRole("button", { name: "Open logs" })
        .click({ timeout: 15_000 })
    },
    settleMs: 1200,
  },
  {
    name: "play-connecting",
    description:
      "The prototype player before the room syncs, held by a silent Yjs socket.",
    path: playPath(ids.branches.framesReady, "layer-frames-ready"),
    beforeNavigate: holdYjsConnection,
  },
  {
    name: "canvas-zoomed-out",
    // After every other Canvas screen on purpose: the zoom persists into the
    // Canvas's saved viewport, so any Canvas screen after this one would open
    // at 10%. Only the home New canvas screens below may follow it.
    description:
      "The Canvas zoomed all the way out with a frame selected: Layer labels and resize handles at minimum zoom.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page
        .getByText("Checkout · desktop", { exact: true })
        .first()
        .click({ timeout: 15_000 })
      await zoomOutFully(page)
    },
    settleMs: 400,
  },

  // --- New canvas (issue #777) ---------------------------------------------
  // Last in the list on purpose: `home-new-canvas` really creates a Canvas, so
  // anything shot after it on the same server would show an extra tile.
  {
    name: "home-new-canvas-hint",
    description: "Hovering the header's New canvas button.",
    path: "/",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "New canvas" })
        .first()
        .hover({ timeout: 15_000 })
      await showTooltip(page)
    },
  },
  {
    name: "home-folder-menu",
    description: "A pinned folder's actions menu in the home sidebar.",
    path: "/",
    prepare: async (page) => {
      await unfreeze(page)
      const row = page
        .locator('[data-sidebar="menu-item"]')
        .filter({ hasText: "Design system" })
        .first()
      await row.hover({ timeout: 15_000 })
      await row.getByRole("button", { name: "Folder actions" }).click()
      await page.getByRole("menu").first().waitFor({ timeout: 5_000 })
      await page.waitForTimeout(300)
    },
    settleMs: 300,
  },
  {
    name: "home-new-canvas",
    description:
      "What pressing New canvas on home opens: the new Untitled Canvas itself.",
    path: "/",
    prepare: async (page) => {
      await unfreeze(page)
      // The header button can be clicked before hydration wires it up, so
      // retry until something happens (a dialog, or the Canvas route).
      const dialog = page.getByRole("dialog")
      for (let i = 0; i < 5; i++) {
        if ((await dialog.count()) || !isHomePath(page.url())) break
        await page.getByRole("button", { name: "New canvas" }).first().click()
        await page.waitForTimeout(800)
      }
      if (!(await dialog.count())) {
        await page
          .getByText("This canvas is empty")
          .waitFor({ timeout: 30_000 })
          .catch(() => {})
      }
      await page.waitForTimeout(1000)
    },
    settleMs: 300,
  },
  // --- Hosted build only (`--hosted`): comments (#789) ---
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
    name: "player-comment-thread",
    description: "A pin opened in the player: the canvas's thread card.",
    hosted: true,
    path: playerCommentsPath(),
    prepare: async (page) => {
      await unfreeze(page)
      const pin = page.locator("[data-comment-pin]").first()
      await pin.waitFor({ timeout: 30_000 })
      await pin.click()
      await page.getByRole("dialog").first().waitFor({ timeout: 10_000 })
    },
    settleMs: 400,
  },
  {
    name: "player-comments-list",
    description:
      "The player's comment list: this route first, then other routes, then the old feed's notes.",
    hosted: true,
    path: playerCommentsPath(),
    prepare: async (page) => {
      await unfreeze(page)
      await page
        .locator("[data-comment-pin]")
        .first()
        .waitFor({ timeout: 30_000 })
        .catch(() => {})
      await openCommentList(page)
    },
    settleMs: 400,
  },
  {
    name: "player-comment-composer",
    description:
      "C in the player, then a click on the order form: the composer on that element.",
    hosted: true,
    path: playerCommentsPath(),
    prepare: async (page) => {
      await unfreeze(page)
      const field = page
        .frameLocator("iframe")
        .locator("section.cols > div.card > .bar.tall")
      await field.waitFor({ timeout: 30_000 })
      await page.keyboard.press("c")
      const box = await field.boundingBox()
      if (!box) throw new Error("the order form has no box")
      await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2)
      await page
        .getByPlaceholder("Add a comment…")
        .pressSequentially("Put Apple Pay above the card fields.", {
          timeout: 10_000,
        })
    },
    settleMs: 400,
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

function isHomePath(url: string): boolean {
  return new URL(url).pathname === "/"
}

/**
 * Open a menu from its trigger and pick an item, walking into submenus: pass
 * `["Restart", "Recreate from scratch"]` to hover the first and click the last.
 */
/**
 * Run a saved Project preset row's action: from its … menu (#784), or from a
 * button of that name on builds before the menu, so "before" captures work.
 */
async function presetRowAction(page: Page, action: string): Promise<void> {
  const more = page.getByRole("button", { name: "More actions" }).first()
  if (await more.isVisible()) {
    await chooseFromMenu(page, more, [action])
    return
  }
  await page
    .getByRole("button", { name: action, exact: true })
    .first()
    .click({ timeout: 15_000 })
}

export async function chooseFromMenu(
  page: Page,
  trigger: Locator,
  path: string | string[]
): Promise<void> {
  const steps = typeof path === "string" ? [path] : path
  // Hover-revealed triggers (sidebar rows) only take a click once their row
  // is hovered.
  await trigger
    .locator("xpath=..")
    .hover({ timeout: 15_000 })
    .catch(() => {})
  await trigger.click({ timeout: 15_000, force: true })
  for (const [i, label] of steps.entries()) {
    // Radix ignores a select that lands in the same beat the menu opened.
    await page.waitForTimeout(300)
    const item = page.getByRole("menuitem", { name: label, exact: true }).last()
    if (i < steps.length - 1) {
      // Open the submenu the way a keyboard user does.
      await item.focus({ timeout: 10_000 })
      await item.press("ArrowRight")
    } else {
      await item.click({ timeout: 10_000 })
    }
  }
}

/**
 * The `…` menu trigger on the sidebar row whose text is `text`: the nearest
 * ancestor of the text that holds a menu trigger, hovered so the trigger shows.
 */
export function rowMenuTrigger(page: Page, text: string): Locator {
  const label = page.getByText(text, { exact: true }).first()
  return label
    .locator(
      "xpath=ancestor::*[.//button[@aria-haspopup='menu']][1]//button[@aria-haspopup='menu']"
    )
    .first()
}

/**
 * The \`…\` menu trigger on a Workspace row, which only shows while the row is
 * hovered: hover the row, then hand back its trigger.
 */
/** Open a Workspace row's … menu and leave it open. */
export async function openBranchRowMenu(
  page: Page,
  ref: string
): Promise<void> {
  const trigger = await branchRowMenu(page, ref)
  await trigger.click({ timeout: 15_000, force: true })
  await page.getByRole("menu").first().waitFor({ timeout: 5_000 })
  // Park the pointer on the menu's edge so no item shows a hover highlight.
  await page.mouse.move(5, 5)
}

export async function branchRowMenu(page: Page, ref: string): Promise<Locator> {
  const row = page
    .locator(".group\\/branch-row")
    .filter({ hasText: ref })
    .first()
  await row.hover({ timeout: 15_000 })
  return row.locator('[aria-haspopup="menu"]').first()
}

/** Click the confirm dialog's action button. */
export async function confirmDialog(page: Page, verb: string): Promise<void> {
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: verb, exact: true })
    .click({ timeout: 10_000 })
}

/**
 * Hold every Next.js server action from here on: `hang` never answers (the
 * pending state), `fail` answers 500 (the error state). Either way the server
 * never runs the action, so the Fixture World is untouched.
 */
export async function holdServerActions(
  page: Page,
  mode: "hang" | "fail"
): Promise<void> {
  await page.route("**/*", async (route) => {
    const request = route.request()
    if (request.method() !== "POST" || !request.headers()["next-action"]) {
      return route.fallback()
    }
    if (mode === "fail") {
      return route.fulfill({ status: 500, body: "Internal Server Error" })
    }
    // hang: leave the request unanswered.
  })
}

/**
 * Answer the Canvas's Yjs socket with a doc built here instead of the Fixture
 * World's, for a state the seeded world can't hold without changing every other
 * screen of that Canvas (a Workspace with no sandbox yet, one deleted while the
 * player is open). The socket never reaches the server, so nothing is written
 * back; the server render still reads the seeded doc.
 *
 * It sends one sync step 2 — y-websocket's "here is the whole doc" — which is
 * all the client needs to count itself synced.
 */
export async function serveYjsDoc(
  page: Page,
  build: (collections: RoomCollections) => void
): Promise<void> {
  const doc = new Y.Doc()
  const collections = getRoomCollections(doc)
  collections.transact(() => build(collections))
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  // messageSync (0), syncStep2 (1), then the update as a length-prefixed buffer.
  const message = Buffer.concat([
    Buffer.from([0, 1, ...varUint(update.length)]),
    Buffer.from(update),
  ])
  // Answer the client's opening sync step 1, as the server would. Next's own
  // dev socket (`/_next/webpack-hmr`) is left alone.
  await page.routeWebSocket(/^(?!.*\/_next\/)/, (ws) => {
    let answered = false
    ws.onMessage(() => {
      if (answered) return
      answered = true
      ws.send(message)
    })
  })
}

/**
 * Mark a Canvas as the first one after setup, as Finish does, so it shows the
 * getting-started checklist (#780).
 */
export async function markGettingStarted(
  page: Page,
  roomId: string
): Promise<void> {
  await page.addInitScript(
    ([key, id]) => localStorage.setItem(key!, id!),
    ["screenplay:getting-started-canvas", roomId]
  )
}

/** The Project the getting-started screens add, as a folder pick would. */
const gettingStartedRepo = {
  id: "repo-getting-started",
  name: "storefront",
  repoFullName: "acme/storefront",
  repoOwner: "acme",
  repoName: "storefront",
  defaultBranch: "main",
  cloneUrl: "https://github.com/acme/storefront.git",
  setupScript: "pnpm install",
  devScript: "pnpm dev --port $PORT",
  devServerPort: 3000,
  envVars: "",
  createdAt: 0,
  sidebarOrder: 0,
}

/** lib0's unsigned varint: 7 bits a byte, high bit set on all but the last. */
function varUint(n: number): number[] {
  const bytes: number[] = []
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80)
    n >>>= 7
  }
  bytes.push(n)
  return bytes
}

/** Open the player's agent panel from the HUD. */
export async function openPlayerAgent(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open agent" }).click()
}

/**
 * Reload the page with the Yjs socket's client → server direction cut, so
 * local canvas writes (a Workspace flipped to `starting`) render but are never
 * persisted into the Fixture World.
 */
export async function freezeYjs(page: Page): Promise<void> {
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer()
    let initialSync = true
    // Let the handshake through so the canvas loads, then drop client writes.
    setTimeout(() => (initialSync = false), 5_000)
    ws.onMessage((message) => {
      if (initialSync) server.send(message)
    })
    server.onMessage((message) => ws.send(message))
  })
  await page.reload({ waitUntil: "load" })
  await page.getByText("Empty cart state", { exact: true }).first().waitFor({
    timeout: 60_000,
  })
  await page.waitForTimeout(5_500)
}

/**
 * The cookie that asks the Fixture World for a server-side failure
 * (`@/lib/fixture-faults`) — one the browser can't cause, like the home layout's
 * own Canvas load.
 */
export function fixtureFault(
  fault: FixtureFault
): Array<{ name: string; value: string }> {
  return [{ name: fixtureFaultCookieName(), value: fault }]
}

/**
 * Fail every server action from here on with a 500, the way a dropped sidecar
 * or a database error reaches the client. A `beforeNavigate` fails a page's
 * loads; a `prepare` calls it once the page is up, so only the mutation it then
 * drives fails.
 */
export async function failServerActions(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    const request = route.request()
    if (request.method() === "POST" && request.headers()["next-action"]) {
      return route.fulfill({ status: 500, body: "simulated failure" })
    }
    return route.fallback()
  })
}

/** Hover a Canvas tile on the home grid and open its ⋯ actions menu. */
export async function openCanvasMenu(page: Page, name: string): Promise<void> {
  await page.getByLabel(`Open ${name}`).first().hover()
  await page
    .getByRole("button", { name: "Canvas actions" })
    .first()
    .click({ timeout: 15_000 })
  await page.getByRole("menu").first().waitFor({ timeout: 5_000 })
  await page.waitForTimeout(300)
}

/**
 * The cookie that puts a Fixture World capture on one of the screens a person
 * meets before the app (`@/lib/fixture-entry`) — the signed-out home or a
 * blocked setup gate, neither of which the always-signed-in, already-set-up
 * fixture build would otherwise show.
 */
export function entryState(
  state: FixtureEntryState
): Array<{ name: string; value: string }> {
  return [{ name: fixtureEntryCookieName(), value: state }]
}

/**
 * The cookie that picks the home surface's grid-or-table layout. Seeded rather
 * than clicked for the same reason as {@link canvasPanels}: the layout is a
 * first-paint decision the server reads off this cookie, so setting it captures
 * the surface as a returning user sees it, with no toggle to find.
 */
export function homeView(view: View): Array<{ name: string; value: string }> {
  return [
    {
      name: homeViewPrefsCookieName(),
      value: encodeURIComponent(
        JSON.stringify(withView(DEFAULT_VIEW_PREFS, view))
      ),
    },
  ]
}

/**
 * The home layout cookie with the sidebar at its 480px maximum, which at
 * {@link NARROW_HOME_VIEWPORT} leaves the content its narrowest (~420px). Like
 * {@link canvasPanels}, the values are percentages of the group; the panel's
 * own `maxSize` clamps anything past 480px.
 */
export function narrowHome(): Array<{ name: string; value: string }> {
  const sidebar = (480 / NARROW_HOME_VIEWPORT.width) * 100
  return [
    {
      name: panelLayoutCookieName("home-layout"),
      value: encodeURIComponent(
        JSON.stringify({
          "home-sidebar": sidebar,
          "home-content": 100 - sidebar,
        })
      ),
    },
  ]
}

/**
 * Pick up the tile or row named `source` and hold it over the one named
 * `target` without letting go, so the shot catches the drop-target highlight.
 *
 * The drag preview floats under the pointer at the spot it was grabbed, so
 * grabbing the source by its bottom edge and hovering the target just inside
 * its top edge keeps the preview above the target rather than on top of it —
 * the drop test is the pointer's position (`pointerWithin`), so that's enough
 * to light it. The sensor waits for 6px of movement before a drag starts, so
 * the pointer nudges first, then travels in steps dnd-kit can track.
 */
export async function dragOnto(
  page: Page,
  source: string,
  target: string
): Promise<void> {
  const draggable = (name: string) =>
    page
      .getByText(name, { exact: true })
      .first()
      .locator(
        "xpath=ancestor-or-self::*[@aria-roledescription='draggable'][1]"
      )
      .boundingBox({ timeout: 15_000 })
  const from = await draggable(source)
  const to = await draggable(target)
  if (!from || !to)
    throw new Error(`drag: ${source} or ${target} not on screen`)
  const grab = { x: from.x + from.width / 2, y: from.y + from.height - 3 }
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x, grab.y - 12)
  await page.mouse.move(to.x + to.width / 2, to.y + 4, { steps: 12 })
}

/**
 * Pick up the tile or row named `source` and hold it over the breadcrumb crumb
 * named `crumb`, without letting go, so the shot catches the crumb's drop
 * highlight. Same pointer choreography as {@link dragOnto}.
 */
export async function dragOntoCrumb(
  page: Page,
  source: string,
  crumb: string
): Promise<void> {
  const from = await page
    .getByText(source, { exact: true })
    .first()
    .locator("xpath=ancestor-or-self::*[@aria-roledescription='draggable'][1]")
    .boundingBox({ timeout: 15_000 })
  const to = await page
    .locator('[data-slot="breadcrumb-item"]', { hasText: crumb })
    .first()
    .boundingBox({ timeout: 15_000 })
  if (!from || !to) throw new Error(`drag: ${source} or ${crumb} not on screen`)
  // Grab by the top-left corner so the preview hangs below and right of the
  // pointer, and hover the crumb's bottom-right corner, so the preview leaves
  // the crumb and its ring in view.
  const grab = { x: from.x + 3, y: from.y + 3 }
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x, grab.y + 12)
  await page.mouse.move(to.x + to.width - 4, to.y + to.height - 4, {
    steps: 12,
  })
}

/**
 * Press Tab until keyboard focus lands on the control named `label`, the way a
 * keyboard user gets there — so the shot shows the `:focus-visible` state a
 * programmatic `.focus()` might not. `within` limits the match to controls
 * inside that selector (the sidebar's pinned rows share their labels with the
 * grid's). Throws after `max` presses, which a `prepare` turns into a warning.
 */
export async function tabTo(
  page: Page,
  label: string,
  options: { within?: string; max?: number; delayMs?: number } = {}
): Promise<void> {
  const { within = "main", max = 60, delayMs = 0 } = options
  const probe = `(() => {
    const el = document.activeElement
    return !!el && el.getAttribute("aria-label") === ${JSON.stringify(label)} &&
      !!el.closest(${JSON.stringify(within)})
  })()`
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab")
    if (delayMs) await page.waitForTimeout(delayMs)
    if (await page.evaluate(probe)) return
  }
  throw new Error(`never reached "${label}" by Tab`)
}

/**
 * Undo the settle step's animation freeze, for a `prepare` that walks through a
 * Radix surface (a menu, a dialog) — those only unmount once their exit
 * animation ends, so a frozen page leaves a closed menu on screen forever. The
 * runner freezes again before the shot.
 */
export async function unfreeze(page: Page): Promise<void> {
  await page.evaluate(`
    for (const el of document.querySelectorAll("style")) {
      if (el.textContent.includes("animation-play-state: paused")) el.remove()
    }
  `)
}

/**
 * Select a Workspace in the in-room sidebar, which points the chat panel at it
 * and restores that Workspace's remembered chat.
 */
/**
 * Wait for the pending plan card's actions. The chat's history loads after the
 * Workspace is selected, so without this the shot catches "Loading chat…".
 */
async function waitForPlanCard(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Approve", exact: true })
    .waitFor({ timeout: 30_000 })
}

/**
 * The checkout Canvas's Workspace that holds the fixture chats ("Checkout
 * polish", "Breakpoint audit", "New chat") and terminal tabs.
 */
const CHAT_WORKSPACE = "Checkout polish"

export async function selectWorkspace(page: Page, ref: string): Promise<void> {
  // The sidebar's Workspace rows are labelled with the Workspace's title
  // (#881), or its git ref when it has none: what a person reads off the
  // screen.
  await page.getByText(ref, { exact: true }).first().click({ timeout: 15_000 })
}

/**
 * Open the failed Workspace's setup error from the sidebar. Where the indicator
 * is a button, it is reached the way a keyboard user would — focus, then Enter —
 * so the shot proves the error is readable without a mouse. On builds where it
 * is still a bare icon (a hover card), fall back to hovering it, which is the
 * only way that version can be opened.
 */
export async function openSetupError(page: Page): Promise<void> {
  // The failed Workspace's status icon is labelled by what failed; it opens
  // the error card.
  const button = page.getByRole("button", { name: /failed$/ })
  await button.first().focus({ timeout: 15_000 })
  await page.keyboard.press("Enter")
  await page
    .getByRole("button", { name: "Copy error" })
    .waitFor({ timeout: 5_000 })
}

/**
 * Select a chat tab in the in-room tab strip by label. The panel itself is
 * opened by {@link canvasPanels}, not from here, so this only ever has to pick
 * between tabs that are already on screen.
 */
export async function openChatTab(
  page: Page,
  label: string,
  workspace = CHAT_WORKSPACE
): Promise<void> {
  // The panel opens on the Coordinator (#893); a chat tab lives in its
  // Workspace's tab strip.
  await selectWorkspace(page, workspace)
  await page
    .getByRole("tab", { name: new RegExp(label, "i") })
    .first()
    .click({ timeout: 15_000 })
  // A cold dev server can hold the history load past the settle delay.
  await page
    .getByText("Loading chat…")
    .first()
    .waitFor({ state: "hidden", timeout: 30_000 })
    .catch(() => {})
}

/** Type into the visible chat composer, as a user would. */
export async function typeInComposer(page: Page, text: string): Promise<void> {
  const editor = page.locator(".tiptap:visible").last()
  await editor.click({ timeout: 15_000 })
  await page.keyboard.type(text)
}

/** Paste a tiny PNG into the visible chat composer. */
export async function pasteImageInComposer(page: Page): Promise<void> {
  await page
    .locator(".tiptap:visible")
    .last()
    .evaluate((el) => {
      const bytes = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        ),
        (c) => c.charCodeAt(0)
      )
      const data = new DataTransfer()
      data.items.add(new File([bytes], "mockup.png", { type: "image/png" }))
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        })
      )
    })
}

/**
 * Open a fresh terminal tab from the tab strip's "New chat or terminal" menu.
 *
 * Opened rather than restored: the fixture world does seed two terminal tabs,
 * but a cold room load currently prunes them as orphans before its Workspaces
 * arrive, so they can't be relied on to be there.
 */
export async function openTerminalTab(page: Page): Promise<void> {
  await selectWorkspace(page, CHAT_WORKSPACE)
  await page
    .getByRole("button", { name: "New chat or terminal" })
    .first()
    .click({ timeout: 15_000 })
  // One harness reads "New terminal"; several list each harness by name under
  // a "New terminal" label — either way the first item after "New chat".
  await page
    .getByRole("menuitem")
    .filter({ hasNotText: "New chat" })
    .first()
    .click({ timeout: 15_000 })
  // Let the menu's exit animation finish before the shot: the settle step
  // pins animations where they stand, which would freeze it half-closed.
  await page.mouse.move(0, 0)
  await page
    .getByRole("menu")
    .waitFor({ state: "detached", timeout: 5_000 })
    .catch(() => {})
}

/**
 * Open the chat panel's history. Matches today's "Chat history" button and the
 * earlier "Closed chats" one, so a before capture of this screen still opens it.
 */
export async function openChatHistory(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /^(Chat history|Closed chats)$/ })
    .first()
    .click({ timeout: 15_000 })
}

/** Select the chat panel's sandbox logs tab (an icon-only tab, named by its label). */
/** The prototype player's URL for one Workspace, opened from one of its frames. */
function playPath(branchId: string, iframeLayerId: string): string {
  return `/play/${ids.rooms.frameStates}/${branchId}?iframe-layer=${iframeLayerId}`
}

export async function openLogsTab(page: Page): Promise<void> {
  await selectWorkspace(page, CHAT_WORKSPACE)
  await page
    .getByRole("tab", { name: "Sandbox logs" })
    .first()
    .click({ timeout: 15_000 })
}

/**
 * Open the same Canvas in a second tab of the capture's context, so it joins the
 * room as another presence (same user, its own awareness client), and park its
 * pointer — optionally with a cursor-chat message — at a screen position.
 *
 * `paletteIndex` picks the presence colour out of the camera's fixed palette by
 * pinning that tab's `Math.random`, since a random swatch would make before and
 * after captures disagree.
 */
export async function addPeer(
  page: Page,
  options: {
    paletteIndex: number
    at: { x: number; y: number }
    message?: string
    viewport?: { width: number; height: number }
  }
): Promise<Page> {
  const peer = await page.context().newPage()
  if (options.viewport) await peer.setViewportSize(options.viewport)
  const pinned = (options.paletteIndex + 0.5) / 8
  // Pinned only for the camera's palette pick: pinning every call breaks the
  // canvas (its pointer never publishes). A source string, not a function —
  // see `openThemedContext`.
  await peer.addInitScript({
    content: `(() => {
      const random = Math.random
      Math.random = function () {
        const stack = new Error().stack || ""
        return /use-canvas-camera|useCanvasCamera/.test(stack) ? ${pinned} : random()
      }
    })()`,
  })
  await peer.goto(page.url())
  // Settled like any captured page: the canvas's text paints server-side long
  // before hydration attaches the pointer handlers that publish presence.
  await settle(peer, { freeze: false })
  await peer.waitForTimeout(1500)
  // Input only reaches the front tab, so the peer is brought forward to move
  // its pointer, then the capture's own tab is handed back the front.
  await peer.bringToFront()
  await peer.mouse.move(options.at.x - 4, options.at.y - 4)
  await peer.mouse.move(options.at.x, options.at.y)
  if (options.message) {
    await peer.keyboard.press("/")
    await peer.keyboard.type(options.message)
  }
  await page.bringToFront()
  return peer
}

/**
 * Pick a Chat Target from the chat panel's header picker — how a Document chat
 * is reached from a Workspace's chat. The panel opens on the Coordinator
 * (#893), whose header has no picker, so a Workspace is opened first.
 */
export async function selectChatTarget(
  page: Page,
  label: string
): Promise<void> {
  await selectWorkspace(page, CHAT_WORKSPACE)
  const trigger = page
    .getByRole("button")
    .filter({ has: page.locator("svg.lucide-chevrons-up-down") })
    .last()
  await trigger.click({ timeout: 15_000 })
  await page
    .getByRole("option", { name: new RegExp(label, "i") })
    .first()
    .click({ timeout: 15_000 })
  // The picker can stay open after the pick; toggle it shut so the chat shows.
  const picker = page.getByPlaceholder("Search branches and layers...")
  const closed = await picker
    .waitFor({ state: "hidden", timeout: 2_000 })
    .then(() => true)
    .catch(() => false)
  if (!closed) await trigger.click({ timeout: 5_000 })
}

/**
 * One chat broadcast event, minus the `chatId`/`id` envelope {@link replayRun}
 * fills in. The same shapes `ChatBroadcastEvent` defines in `lib/chat-store.ts`.
 */
export type RunEvent = Record<string, unknown> & { type: string }

/**
 * Replay a run's broadcast events into a chat. The harness has no agent to run,
 * so a run's live states (streaming, stopped) are reached by feeding the chat
 * store the events a real run broadcasts, through the handle the Fixture World
 * build exposes. Passed as a source string for the same `__name` reason as the
 * theme init script (`lib/browser.ts`).
 */
export async function replayRun(
  page: Page,
  chatId: string,
  events: readonly RunEvent[]
): Promise<void> {
  const payload = JSON.stringify(
    events.map((e, i) => ({
      ...e,
      chatId,
      id: `fixture-${chatId}-${Date.now()}-${i}`,
    }))
  )
  await page.evaluate(
    `for (const e of ${payload}) window.__chatStore?.handleBroadcastEvent(e)`
  )
}

const text = (t: string) => ({ type: "text", text: t })

/** A run part-way through: the prompt, a finished tool call, and half a reply. */
export function streamingRun(): RunEvent[] {
  return [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "user_message_chunk",
        content: text("Make the order summary sticky on mobile."),
      },
    },
    { type: "chat-stream-start" },
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

/**
 * A finished Coordinator turn on the checkout canvas: the question, a
 * `read_canvas` call, and an answer that matches the fixture world.
 */
export function coordinatorRun(): RunEvent[] {
  return [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "user_message_chunk",
        content: text("What's on this canvas?"),
      },
    },
    { type: "chat-stream-start" },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "fixture-read-canvas",
        title: "read_canvas",
        kind: "read",
        status: "completed",
      },
    },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text(
          [
            "Four Workspaces on acme/storefront:",
            "",
            "- **Checkout polish**: +214 −37, PR #482 open",
            "- **Empty cart state**: +46 −4, no PR yet",
            "- **Apple Pay button**: still starting",
            "- **gift-cards**: setup failed",
            "",
            "There are four frames (checkout on desktop and iPhone, the empty cart, and one with no Workspace) and one document, Checkout brief.",
          ].join("\n")
        ),
      },
    },
    { type: "chat-stream-end" },
  ]
}

/** The ask the Coordinator splits across two Workspaces (#896). */
const DELEGATED_STICKY = "Make the order summary sticky on mobile, below 768px."

/**
 * A finished Coordinator turn that messaged two Workspaces on the checkout
 * canvas: its reply, one `send_to_workspace` call per Workspace (task rows),
 * and a closing line.
 */
export function delegationRun(): RunEvent[] {
  const send = (
    toolCallId: string,
    branchId: string,
    title: string,
    chatId: string,
    message: string
  ): RunEvent => ({
    type: "chat-acp-update",
    update: {
      sessionUpdate: "tool_call",
      toolCallId,
      title: "send_to_workspace",
      status: "completed",
      rawInput: { workspace_id: branchId, message },
      content: [
        {
          type: "content",
          content: text(sentToWorkspaceResult(title, chatId)),
        },
      ],
    },
  })
  return [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "user_message_chunk",
        content: text(
          "Pin the order summary on mobile in Checkout polish, and add a Continue shopping link to the empty cart."
        ),
      },
    },
    { type: "chat-stream-start" },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text("Those belong to two Workspaces, so I sent one to each."),
      },
    },
    send(
      "fixture-send-checkout",
      ids.branches.checkoutPolish,
      "Checkout polish",
      ids.chats.checkoutPolish,
      DELEGATED_STICKY
    ),
    send(
      "fixture-send-empty-cart",
      ids.branches.emptyCart,
      "Empty cart state",
      "chat-empty-cart",
      "Add a Continue shopping link under the empty cart message."
    ),
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text(
          "\n\nEmpty cart state is still waiting for you to approve its plan, so it will pick this up after that. I'll tell you when they're done or need you."
        ),
      },
    },
    { type: "chat-stream-end" },
  ]
}

/**
 * A Workspace turn the Coordinator started: the Delegated Message (its turn
 * markers, as persisted), a step, and the agent's reply.
 */
export function delegatedWorkspaceRun(): RunEvent[] {
  return [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "user_message_chunk",
        content: text(
          prependTurnMarkers(DELEGATED_STICKY, {
            delegatedFrom: roomChatId(ids.rooms.checkout),
          })
        ),
      },
    },
    { type: "chat-stream-start" },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "fixture-delegated-read",
        title: "read_file",
        kind: "read",
        status: "completed",
        rawInput: { path: "app/checkout/summary.tsx" },
      },
    },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "fixture-delegated-edit",
        title: "edit_file",
        kind: "edit",
        status: "completed",
        rawInput: { path: "app/checkout/summary.tsx" },
      },
    },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text(
          "The summary is now `position: sticky` at the bottom of the viewport below 768px, with a top border so it separates from the form."
        ),
      },
    },
    { type: "chat-stream-end" },
  ]
}

/**
 * Two Coordinator turns on the checkout canvas: it removes a frame and a
 * document right away, then puts them back when asked to undo (#894).
 */
export function coordinatorUndoRun(): RunEvent[] {
  const turn = (
    ask: string,
    tool: {
      id: string
      title: string
      kind: "delete" | "edit"
      result: string
    },
    answer: string
  ): RunEvent[] => [
    {
      type: "chat-acp-update",
      update: { sessionUpdate: "user_message_chunk", content: text(ask) },
    },
    { type: "chat-stream-start" },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: tool.id,
        title: tool.title,
        kind: tool.kind,
        status: "completed",
        content: [{ type: "content", content: text(tool.result) }],
      },
    },
    {
      type: "chat-acp-update",
      update: { sessionUpdate: "agent_message_chunk", content: text(answer) },
    },
    { type: "chat-stream-end" },
  ]
  return [
    ...turn(
      "Clear out the frame with no Workspace and the Checkout brief.",
      {
        id: "fixture-remove",
        title: "remove",
        kind: "delete",
        result: 'Removed frame "Untitled frame", document "Checkout brief".',
      },
      "Removed the blank frame and the Checkout brief."
    ),
    ...turn(
      "Actually, undo that.",
      {
        id: "fixture-undo",
        title: "undo_changes",
        kind: "edit",
        result:
          'Undid: removed frame "Untitled frame", document "Checkout brief".\nIds: fixture-turn',
      },
      "Put the blank frame and the Checkout brief back, exactly as they were."
    ),
  ]
}

/**
 * Expand a collapsed tool-call row whose accessible name matches `name`. Skips
 * a row that already reports itself open, so a row that opens by default (a
 * failed call showing its reason) isn't toggled shut.
 */
/**
 * Open every finished turn's summary line, so the steps folded behind it show.
 * Tolerates a transcript with none (a build from before #800), so the same
 * screens shoot a "before" set.
 */
export async function expandTurnSummaries(page: Page): Promise<void> {
  await page
    .locator('[data-testid="turn-summary-trigger"]:visible')
    .first()
    .waitFor({ timeout: 5_000 })
    .catch(() => {})
  // Other chat tabs stay mounted but hidden, so only the visible ones count.
  const closed = page.locator(
    '[data-testid="turn-summary-trigger"][aria-expanded="false"]:visible'
  )
  while ((await closed.count()) > 0) await closed.first().click()
}

export async function expandToolCall(page: Page, name: RegExp): Promise<void> {
  const row = page.getByRole("button", { name }).first()
  await row.waitFor({ timeout: 10_000 })
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click()
}

/**
 * A finished run with one tool call in every state the row has: a read whose
 * path overflows the row, an edit carrying a diff, a command that failed with
 * a reason and one that failed with none, and a command still running. It ends
 * on a transcript error long enough to wrap.
 */
export function toolStatesRun(): RunEvent[] {
  const call = (update: Record<string, unknown>): RunEvent => ({
    type: "chat-acp-update",
    update: { sessionUpdate: "tool_call", ...update },
  })
  return [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "user_message_chunk",
        content: text("Pin the order summary on mobile and run the build."),
      },
    },
    { type: "chat-stream-start" },
    call({
      toolCallId: "fixture-states-read",
      title:
        "Read apps/storefront/app/(checkout)/components/summary/sticky-order-summary.tsx",
      kind: "read",
      status: "completed",
      rawInput: {
        file_path:
          "apps/storefront/app/(checkout)/components/summary/sticky-order-summary.tsx",
      },
      content: [
        {
          type: "content",
          content: text(
            '     1→export function StickyOrderSummary() {\n     2→  return <aside className="md:static" />\n     3→}'
          ),
        },
      ],
    }),
    call({
      toolCallId: "fixture-states-edit",
      title: "Edit app/checkout/summary.tsx",
      kind: "edit",
      status: "completed",
      rawInput: { file_path: "app/checkout/summary.tsx" },
      content: [
        {
          type: "diff",
          path: "app/checkout/summary.tsx",
          oldText: [
            "export function OrderSummary({ items }: Props) {",
            "  return (",
            '    <aside className="md:static">',
            "      <Totals items={items} />",
            "    </aside>",
            "  )",
            "}",
          ].join("\n"),
          newText: [
            "export function OrderSummary({ items }: Props) {",
            "  return (",
            '    <aside className="sticky bottom-0 md:static">',
            "      <Totals items={items} />",
            "      <PayButton />",
            "    </aside>",
            "  )",
            "}",
          ].join("\n"),
        },
      ],
    }),
    call({
      toolCallId: "fixture-states-build",
      title: "pnpm build",
      kind: "execute",
      status: "failed",
      rawInput: { command: "pnpm build --filter storefront" },
      content: [
        {
          type: "content",
          content: text(
            "app/checkout/summary.tsx:5:8 - error TS2304: Cannot find name 'PayButton'.\n\nFound 1 error in app/checkout/summary.tsx:5"
          ),
        },
      ],
    }),
    call({
      toolCallId: "fixture-states-deploy",
      title: "Preview deploy",
      kind: "execute",
      status: "failed",
      rawInput: { command: "pnpm deploy:preview" },
    }),
    call({
      toolCallId: "fixture-states-test",
      title: "pnpm test",
      kind: "execute",
      status: "in_progress",
      rawInput: {
        command:
          "pnpm test --filter storefront -- app/checkout/summary.test.tsx --reporter=verbose",
      },
    }),
    {
      type: "chat-control",
      control: {
        kind: "error",
        message:
          "The agent stopped responding: request to https://api.example.com/v1/sessions/4f9c2e1a-8b7d-4c3e-9a2f-1d5e6b7c8a9f/prompt timed out after 120000ms",
      },
    },
  ]
}

/**
 * Wait for the hovered control's tooltip and show it at rest.
 *
 * The runner freezes animations before `prepare` runs, which would pin a
 * tooltip on the first frame of its fade-in — i.e. invisible. Dropping the
 * animation on tooltip content alone lets it paint in its final state.
 */
/**
 * Ctrl+wheel the Canvas out to its minimum zoom, centered on the viewport, then
 * wait out the camera's settle so the overlays come back.
 */
export async function zoomOutFully(page: Page): Promise<void> {
  const box = page.viewportSize() ?? DEFAULT_VIEWPORT
  await page.mouse.move(box.width / 2, box.height / 2)
  await page.keyboard.down("Control")
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(30)
  }
  await page.keyboard.up("Control")
  await page.mouse.move(box.width - 40, box.height / 2)
  await page.waitForTimeout(500)
}

export async function showTooltip(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `[data-slot="tooltip-content"] { animation: none !important; }`,
  })
  await page
    .locator('[data-slot="tooltip-content"]')
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => {})
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

/**
 * Look up screens by name, preserving {@link SCREENS} order, from the screens
 * of one build (see {@link Screen.hosted}). Throws on an unknown name.
 */
export function selectScreens(
  names: readonly string[],
  { hosted = false }: { hosted?: boolean } = {}
): Screen[] {
  const pool = SCREENS.filter((screen) => !!screen.hosted === hosted)
  if (names.length === 0) return pool
  const unknown = names.filter((name) => !pool.some((s) => s.name === name))
  if (unknown.length > 0) {
    throw new Error(
      `unknown ${hosted ? "hosted " : ""}screen(s): ${unknown.join(", ")}\nknown screens: ${pool.map((s) => s.name).join(", ")}`
    )
  }
  return pool.filter((screen) => names.includes(screen.name))
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

/** Select the Checkout Canvas's desktop frame and wait for its toolbar. */
/** The Workspace hover card (#882), which opens after its hover delay. */
async function waitForWorkspaceHoverCard(page: Page): Promise<void> {
  await page
    .locator("[data-slot=hover-card-content]")
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
}

async function selectCheckoutFrame(page: Page): Promise<void> {
  await page
    .getByText("Checkout · desktop", { exact: true })
    .first()
    .click({ timeout: 15_000 })
  await page
    .locator("#frame-toolbar-portal button")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
}

/**
 * The cookie that signs the Fixture World in to GitHub (`@/lib/fixture-github`),
 * so GitHub-backed lists answer with the fixture account's repositories.
 */
/** Make a model reachable for settings detection (`slow` answers after 20s). */
export function fixtureModel(
  mode: "connected" | "slow"
): Array<{ name: string; value: string }> {
  return [{ name: fixtureModelCookieName(), value: mode }]
}

export function fixtureGitHub(): Array<{ name: string; value: string }> {
  return [{ name: fixtureGitHubCookieName(), value: "connected" }]
}

/** Open Canvas settings from the canvas name's ⋯ menu (#883). */
async function openCanvasSettings(page: Page): Promise<void> {
  await openCanvasOptions(page)
  await page.getByRole("menuitem", { name: "Settings" }).click()
  await page.getByRole("dialog", { name: "Canvas settings" }).waitFor()
}

/** Open the canvas name's ⋯ menu. The first click can land before hydration,
 *  so retry until the menu is up. */
async function openCanvasOptions(page: Page): Promise<void> {
  const settings = page.getByRole("menuitem", { name: "Settings" })
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.getByRole("button", { name: "Canvas options" }).click()
    try {
      await settings.waitFor({ timeout: 1500 })
      return
    } catch {
      await page.keyboard.press("Escape")
    }
  }
  await settings.waitFor()
}

/**
 * The sidebar's New workspace (+) button. Before #884 it sat on the hovered
 * repository row, so hover that first when it's there; a before/after pair
 * then shoots the same state.
 */
async function newWorkspaceButton(page: Page): Promise<Locator> {
  const button = page.locator('[aria-label="New workspace"]').first()
  await button.waitFor({ state: "attached", timeout: 15_000 })
  const repoRow = page.locator("[class*='group/workspace-row']").first()
  if (await repoRow.count()) await repoRow.hover()
  return button
}

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
  const row = page
    .locator(".group\\/branch-row")
    .filter({ hasText: ref })
    .first()
  await row.hover()
  await row.locator('[aria-haspopup="menu"]').first().click({ timeout: 15_000 })
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

/**
 * Open Add repository from Canvas settings (the one place it lives since
 * #884) and pick one of its two entries: `github` (the repo list) or `folder`
 * (the native folder dialog, which a capture browser can't reach, so it falls
 * back to the path form). The first click can land before hydration, so retry
 * until the menu is up.
 */
export async function openAddProject(
  page: Page,
  entry: "github" | "folder"
): Promise<void> {
  await unfreeze(page)
  const settings = page.getByRole("dialog", { name: "Canvas settings" })
  if (!(await settings.count())) await openCanvasSettings(page)
  const menu = page.getByRole("menu")
  for (let i = 0; i < 5 && !(await menu.count()); i++) {
    await settings
      .getByRole("button", { name: "Add repository" })
      .first()
      .click({ timeout: 15_000 })
    await page.waitForTimeout(500)
  }
  await page
    .getByRole("menuitem", {
      name: entry === "github" ? "Open GitHub repository" : "Open folder",
    })
    .click()
  await page.getByRole("dialog").last().waitFor({ timeout: 15_000 })
}

/**
 * Two folders on this machine for the Local folder tab: `checkout`, a git
 * checkout of a pnpm app (so detection has something to find), and `plain`, a
 * folder that isn't a repository. Rebuilt on every call; cheap and idempotent.
 */
export function fixtureCheckouts(): { checkout: string; plain: string } {
  const root = join(tmpdir(), "screenplay-fixture-folders")
  const checkout = join(root, "storefront")
  const plain = join(root, "sketches")
  mkdirSync(checkout, { recursive: true })
  mkdirSync(plain, { recursive: true })
  writeFileSync(
    join(checkout, "package.json"),
    JSON.stringify(
      {
        name: "storefront",
        packageManager: "pnpm@10.0.0",
        scripts: {
          dev: "next dev -p 4000",
          "db:generate": "prisma generate",
        },
        dependencies: { next: "15.0.0" },
      },
      null,
      2
    )
  )
  writeFileSync(join(checkout, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
  writeFileSync(
    join(checkout, "README.md"),
    "# Storefront\n\nRun `pnpm install` and `pnpm db:generate` once, then `pnpm dev` and open http://localhost:4000.\n"
  )
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: checkout })
  return { checkout, plain }
}

/** Add the fixture checkout through the folder form, landing on its settings. */
export async function addFixtureFolder(page: Page): Promise<void> {
  const { checkout } = fixtureCheckouts()
  await openAddProject(page, "folder")
  await page.getByPlaceholder("/path/to/your/clone").fill(checkout)
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await page.getByText("Configure repository").waitFor({ timeout: 15_000 })
  // Let detection land so the form shows what it found.
  await page
    .getByText("Detecting settings…")
    .waitFor({ state: "detached", timeout: 15_000 })
}

/** Hover a Workspace row in the sidebar by its branch (or title). */
async function hoverWorkspaceRow(page: Page, name: string): Promise<void> {
  await page
    .locator(".group\\/branch-row")
    .filter({ hasText: name })
    .first()
    .hover({ timeout: 15_000 })
}
