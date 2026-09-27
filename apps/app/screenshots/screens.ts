import type { Locator, Page } from "playwright-core"

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
import { panelLayoutCookieName } from "@/lib/panel-layout"

import { stubLogs, stubTerminal } from "./fixtures/streams"
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
    description: "Settings at the narrowest content width.",
    path: "/settings",
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
      // The menu opens on its first item, Rename; Move to… is next.
      await page.keyboard.press("ArrowDown")
      await page.waitForTimeout(300)
      await page.keyboard.press("Enter")
      // The dialog focuses its first destination as it opens.
      await page.getByRole("radiogroup").first().waitFor({ timeout: 5_000 })
      await page.keyboard.press("ArrowDown")
    },
    settleMs: 300,
  },
  {
    name: "settings",
    description:
      "Settings: appearance, Projects (the saved presets), coding agents.",
    path: "/settings",
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
      "The agent chat panel: a finished turn with diff, terminal, subagent, and failed tool calls.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "Checkout polish")
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
      await selectWorkspace(page, "empty-cart-state")
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
      await page.getByTitle("Stop").first().click({ timeout: 10_000 })
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
      // The chat header's trigger is labelled with the current Workspace's
      // ref; the frame labels on the canvas share that shape and come first.
      await page
        .locator("button:has(svg.lucide-chevrons-up-down)")
        .filter({ hasText: "checkout-polish" })
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
        .getByText(/^Choose a (branch|workspace)$/)
        .first()
        .click({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "dialog-new-workspace",
    description:
      "The prompt-first New workspace dialog, opened from a Project row.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page.getByText("acme/storefront").first().hover()
      await page
        .locator('[title="New workspace"], [title="New Workspace"]')
        .first()
        .click({ timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "dialog-remove-project",
    description: "Removing a Project from a Canvas: the confirm dialog.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page.getByText("acme/storefront").first().hover()
      await page.locator('[title="More"]').first().click({ timeout: 15_000 })
      // Radix ignores a select that lands in the same beat the menu opened.
      await page.waitForTimeout(300)
      await page.getByRole("menuitem", { name: "Remove" }).click()
    },
    settleMs: 400,
  },
  {
    name: "dialog-delete-workspace",
    description: "Deleting a Workspace from its row menu: the confirm dialog.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      const row = page
        .locator(".group\\/branch-row")
        .filter({ hasText: "checkout-polish" })
        .first()
      await row.hover()
      await row
        .locator('[aria-haspopup="menu"]')
        .first()
        .click({ timeout: 15_000 })
      await page.waitForTimeout(300)
      await page.getByRole("menuitem", { name: "Delete" }).click()
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
    name: "confirm-delete-workspace",
    description: "Canvas sidebar → a Workspace's … menu → Delete.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await chooseFromMenu(page, rowMenuTrigger(page, "empty-cart-state"), [
        "Delete",
      ])
    },
    settleMs: 300,
  },
  {
    name: "confirm-remove-project",
    description: "Canvas sidebar → the Project's … menu → Remove.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await chooseFromMenu(page, rowMenuTrigger(page, "acme/storefront"), [
        "Remove",
      ])
    },
    settleMs: 300,
  },
  {
    name: "confirm-recreate-workspace",
    description: "Canvas sidebar → a Workspace's … → Restart → Recreate.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await chooseFromMenu(page, rowMenuTrigger(page, "empty-cart-state"), [
        "Restart",
        "Recreate from scratch",
      ])
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
      await chooseFromMenu(page, rowMenuTrigger(page, "empty-cart-state"), [
        "Restart",
        "Recreate from scratch",
      ])
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
      await chooseFromMenu(page, rowMenuTrigger(page, "empty-cart-state"), [
        "Restart",
        "Recreate from scratch",
      ])
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
    description: "Settings → a saved Project preset's Delete button.",
    path: "/settings",
    prepare: async (page) => {
      // Held so a build without the confirm deletes nothing for real.
      await holdServerActions(page, "hang")
      await page
        .getByRole("button", { name: "Delete", exact: true })
        .first()
        .click({ timeout: 15_000 })
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
        .getByRole("button", { name: "Skip for now" })
        .click({ timeout: 15_000 })
      await page
        .locator("button:not([disabled])", { hasText: "Finish" })
        .waitFor({ timeout: 15_000 })
    },
    settleMs: 300,
  },
]

/**
 * Open a menu from its trigger and pick an item, walking into submenus: pass
 * `["Restart", "Recreate from scratch"]` to hover the first and click the last.
 */
export async function chooseFromMenu(
  page: Page,
  trigger: Locator,
  path: string | string[]
): Promise<void> {
  const steps = typeof path === "string" ? [path] : path
  await trigger.click({ timeout: 15_000, force: true })
  for (const [i, label] of steps.entries()) {
    const item = page
      .getByRole("menuitem", { name: label, exact: true })
      .first()
    if (i < steps.length - 1) {
      await item.hover({ timeout: 10_000 })
      await item.press("ArrowRight").catch(() => {})
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
  await page.getByText("empty-cart-state", { exact: true }).first().waitFor({
    timeout: 60_000,
  })
  await page.waitForTimeout(5_500)
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
export async function selectWorkspace(page: Page, ref: string): Promise<void> {
  // The sidebar's Workspace rows are labelled with the git ref, which is the
  // one part of a Workspace a person reads off the screen.
  await page.getByText(ref, { exact: true }).first().click({ timeout: 15_000 })
}

/**
 * Select a chat tab in the in-room tab strip by label. The panel itself is
 * opened by {@link canvasPanels}, not from here, so this only ever has to pick
 * between tabs that are already on screen.
 */
export async function openChatTab(page: Page, label: string): Promise<void> {
  await page
    .getByRole("tab", { name: new RegExp(label, "i") })
    .first()
    .click({ timeout: 15_000 })
}

/**
 * Open a fresh terminal tab from the tab strip's "New chat or terminal" menu.
 *
 * Opened rather than restored: the fixture world does seed two terminal tabs,
 * but a cold room load currently prunes them as orphans before its Workspaces
 * arrive, so they can't be relied on to be there.
 */
export async function openTerminalTab(page: Page): Promise<void> {
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

/** Select the chat panel's sandbox logs tab (an icon-only tab, named by its label). */
export async function openLogsTab(page: Page): Promise<void> {
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
 * is reached, since the panel opens on the Canvas's first Workspace.
 */
export async function selectChatTarget(
  page: Page,
  label: string
): Promise<void> {
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

/** Look up screens by name, preserving {@link SCREENS} order. Throws on an unknown name. */
export function selectScreens(names: readonly string[]): Screen[] {
  if (names.length === 0) return SCREENS
  const unknown = names.filter((name) => !SCREENS.some((s) => s.name === name))
  if (unknown.length > 0) {
    throw new Error(
      `unknown screen(s): ${unknown.join(", ")}\nknown screens: ${SCREENS.map((s) => s.name).join(", ")}`
    )
  }
  return SCREENS.filter((screen) => names.includes(screen.name))
}
