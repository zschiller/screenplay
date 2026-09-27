import type { Page } from "playwright-core"

import {
  DEFAULT_VIEW_PREFS,
  homeViewPrefsCookieName,
  withView,
  type View,
} from "@/lib/home-view-prefs"
import { panelLayoutCookieName } from "@/lib/panel-layout"

import { FIXTURE_IDS } from "./fixtures/world"

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
   * loading state stays on screen long enough to photograph.
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
    name: "canvas-narrow",
    description:
      "The Canvas at a narrow window, where the panels compete for width.",
    path: `/${ids.rooms.checkout}`,
    viewport: { width: 1024, height: 768 },
  },
  {
    name: "player",
    description: "The prototype player for a running Workspace.",
    path: `/play/${ids.rooms.checkout}/${ids.branches.checkoutPolish}`,
  },
]

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
