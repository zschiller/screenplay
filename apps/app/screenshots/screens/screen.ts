import type { Page } from "playwright-core"

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
   * (`../fixtures/streams.ts`).
   */
  beforeNavigate?: (page: Page) => Promise<void>
}

/** The window every screen is shot at unless it overrides it. */
export const DEFAULT_VIEWPORT = { width: 1512, height: 982 } as const

/**
 * The desktop app's smallest window (`minWidth` in the Tauri config) — the
 * narrowest the home content ever gets once {@link narrowHome} drags the sidebar
 * to its widest.
 */
export const NARROW_HOME_VIEWPORT = { width: 900, height: 768 } as const
