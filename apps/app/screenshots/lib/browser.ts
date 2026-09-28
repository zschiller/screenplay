import {
  chromium,
  type Browser,
  type BrowserContext,
  type Frame,
  type Page,
} from "playwright-core"

import type { CaptureProfile } from "../profile"
import { hostedSessionCookie } from "./hosted"
import { sleep } from "./server"

/**
 * Browser plumbing shared by the screen runner and the interaction recorder:
 * launching Chromium, opening a **theme-pinned** context, and deciding when a
 * page has settled enough to shoot.
 */

/** The two themes every screen is captured in. */
export const THEMES = ["light", "dark"] as const
export type Theme = (typeof THEMES)[number]

/** Device scale factor for captures. 2 for retina-quality PNGs a designer can zoom into. */
const DEVICE_SCALE_FACTOR = 2

/** The Iframe Layer loading overlay's copy — the one signal that a frame is still
 *  waiting on its preview. Matched on text because the overlay carries no stable
 *  hook; if this drifts, canvas shots simply settle on the timeout instead. */
const FRAME_WAITING_TEXT = "Waiting for dev server"

/**
 * Launch Chromium.
 *
 * `PLAYWRIGHT_CHROMIUM_EXECUTABLE` is honored for an environment that
 * pre-installs a browser Playwright didn't download itself (some cloud dev
 * containers do); otherwise Playwright resolves the build pinned by the
 * `playwright-core` version in `package.json`, which is what
 * `pnpm screenshots:browsers` installs.
 */
export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    // The app is served over plain http on loopback and renders animation-heavy
    // canvas chrome; no sandbox is needed and `--font-render-hinting=none` keeps
    // text rasterisation identical across hosts, so a before/after diff shows
    // real changes rather than hinting noise.
    args: ["--font-render-hinting=none", "--disable-lcd-text"],
  })
}

export interface ContextOptions {
  viewport: { width: number; height: number }
  theme: Theme
  /** Directory to record video into. Omit for a screenshot-only context. */
  recordVideoDir?: string
  /**
   * Cookies to set before the first navigation. The app seeds several
   * first-paint decisions from cookies (panel widths, the home grid's view
   * mode), so a screen that wants a panel open sets it here rather than clicking
   * it open — no click to break, and no flash of the closed state in the shot.
   */
  cookies?: Array<{ name: string; value: string }>
}

/**
 * Open a context pinned to one theme.
 *
 * The app runs `next-themes` with `defaultTheme="system"` and `enableSystem`, so
 * the theme is pinned **twice on purpose**: `colorScheme` drives the
 * `prefers-color-scheme` media query the "system" default resolves against, and
 * an init script pre-seeds `localStorage.theme` so the resolution happens before
 * first paint. Either alone leaves a window where the wrong theme is on screen —
 * and a capture that lands inside that window is a light screenshot in the dark
 * set.
 */
export async function openThemedContext(
  browser: Browser,
  profile: CaptureProfile,
  options: ContextOptions
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: profile.baseUrl,
    viewport: options.viewport,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    colorScheme: options.theme,
    // Match the profile's TZ and a fixed locale so dates and number formats in a
    // capture don't depend on the capturing machine.
    timezoneId: "UTC",
    locale: "en-US",
    ...(options.recordVideoDir
      ? { recordVideo: { dir: options.recordVideoDir, size: options.viewport } }
      : {}),
  })

  // A hosted capture is always signed in, as the fixture user.
  const cookies = [
    ...(profile.hosted ? [hostedSessionCookie(profile)] : []),
    ...(options.cookies ?? []),
  ]
  if (cookies.length) {
    await context.addCookies(
      cookies.map((cookie) => ({
        ...cookie,
        url: profile.baseUrl,
        sameSite: "Lax" as const,
      }))
    )
  }

  // The fixture world has no agent runs, so the heal check a Canvas sends for
  // each chat stored as streaming would end every one on load. Answer it
  // without touching the doc, so a fixture's in-flight turn stays in flight
  // and every screen of that room sees the same state (#963).
  await context.route("**/api/branch/heal", (route) =>
    route.fulfill({ status: 200, json: { ok: true } })
  )

  // Passed as a **source string**, not a function. `tsx` runs this harness
  // through esbuild with name-keeping on, which rewrites a function literal to
  // reference an `__name` helper that exists in this process and not in the
  // page — so a function-valued init script throws `__name is not defined` on
  // every navigation, silently, before it can do anything.
  await context.addInitScript({
    content: initScript(options.theme),
  })

  return context
}

export interface SettleOptions {
  /** Extra hold after the generic waits, for a screen with its own entrance beat. */
  extraMs?: number
  /**
   * Pin every animation and transition once settled, so two runs of the same
   * screen agree pixel for pixel. Right for a still; **wrong for a recording** —
   * the recorder passes `false`, since a frozen page is the one thing a motion
   * review can't use.
   */
  freeze?: boolean
}

/**
 * Wait for a page to be worth shooting.
 *
 * The canvas surface never reaches network idle: the Yjs WebSocket stays open,
 * the thumbnail poll ticks, and frames bound to a Workspace probe a dev-server
 * URL that (in a fixture world) will never answer. So this waits on the things
 * that *do* settle — the document, fonts, and the app's own skeletons
 * disappearing — and then holds for one quiet animation beat.
 */
export async function settle(
  page: Page,
  options: SettleOptions = {}
): Promise<void> {
  const { extraMs = 0, freeze = true } = options
  await page.waitForLoadState("domcontentloaded")
  // Fonts first: a shot taken before Geist loads captures fallback metrics, which
  // makes every line of text differ in a before/after diff.
  // Expressions as strings, for the same esbuild `__name` reason as the init
  // script above.
  await page.evaluate("document.fonts && document.fonts.ready").catch(() => {})

  // The skeletons the app paints while a surface hydrates. Absent on most screens,
  // so a miss is normal and must not fail the capture.
  await page
    .waitForFunction(
      `document.querySelectorAll("[data-slot='skeleton']").length === 0`,
      undefined,
      { timeout: 10_000 }
    )
    .catch(() => {})

  // Iframe Layers sit behind a "Waiting for dev server…" overlay until the
  // preview answers the probe *and* its Sandbox Bridge reports the page is up —
  // two round-trips the generic waits above can't see. The fixture preview
  // server makes that happen within a second or two; on a screen with no frames
  // the locator matches nothing and this resolves at once. A timeout here is a
  // legitimate capture (the waiting state is a real state), so it's tolerated.
  await page
    .getByText(FRAME_WAITING_TEXT, { exact: false })
    .first()
    .waitFor({ state: "detached", timeout: 20_000 })
    .catch(() => {})

  // Images and embedded pages load after the document does, and on a cold
  // server the first request for them is slow: without this the first screen
  // of a run can catch the home cards' thumbnails or a player preview still
  // blank, and the next run flips the image back.
  await Promise.all(page.frames().map(waitForMedia))

  // One beat for entrance transitions (`disableTransitionOnChange` covers the
  // theme flip, not the app's own mount animations).
  await sleep(600 + extraMs)

  if (!freeze) return

  // Freeze anything still moving, so two runs of the same screen agree. The
  // caret is hidden too: a blinking cursor in a focused composer lands in half
  // the shots and not the other half.
  await page
    .addStyleTag({
      content: `*, *::before, *::after {
        animation-play-state: paused !important;
        animation-delay: 0ms !important;
        transition: none !important;
        caret-color: transparent !important;
      }`,
    })
    .catch(() => {})
}

/**
 * Wait for one frame's fonts and images (loaded or failed), and for an
 * embedded page's load event. Not the top page's: the canvas keeps long-lived
 * connections open and may never fire it. A frame that never gets there (a
 * preview that won't answer) is a legitimate capture, so a timeout is
 * tolerated.
 */
async function waitForMedia(frame: Frame): Promise<void> {
  if (frame.parentFrame()) {
    await frame.waitForLoadState("load", { timeout: 10_000 }).catch(() => {})
  }
  // A string expression, for the esbuild `__name` reason above.
  await frame
    .waitForFunction(
      `Array.from(document.images).every((img) => img.complete) &&
        (!document.fonts || document.fonts.status === "loaded")`,
      undefined,
      { timeout: 10_000 }
    )
    .catch(() => {})
}

/**
 * The per-navigation setup every captured page gets, as source text.
 *
 * Two jobs, both of which have to happen before the app's own scripts run:
 * pinning the theme so `next-themes` resolves it on the first paint, and hiding
 * the `next dev` overlay (the route-compile indicator and the devtools button),
 * which is part of the dev server rather than the app and would otherwise sit in
 * the corner of every shot — and in the before/after diff, since a route is only
 * "compiling" on whichever run happened to hit it cold.
 */
function initScript(theme: Theme): string {
  return `
(function () {
  try {
    // next-themes' default storage key. Belt to the \`colorScheme\` braces: it
    // makes the resolution happen before first paint rather than after the
    // media query is read, closing the window where the wrong theme is painted.
    window.localStorage.setItem("theme", ${JSON.stringify(theme)});
  } catch (err) {
    // Storage can be blocked; \`colorScheme\` still carries the theme.
  }
  var hide = function () {
    var root = document.head || document.documentElement;
    if (!root) {
      document.addEventListener("DOMContentLoaded", hide, { once: true });
      return;
    }
    var style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    root.appendChild(style);
  };
  hide();
})();
`
}
