import type { Page } from "playwright-core"

import { FIXTURE_IDS } from "./fixtures/world"
import { canvasPanels, DEFAULT_VIEWPORT } from "./screens"

/**
 * The **named interactions** — short flows the harness records to video.
 *
 * A still can't review a motion change: an entrance animation, a drag, a panel
 * that slides. Each entry here is one flow, named so a PR can say "recorded
 * `open-canvas`" and a reviewer can re-record the same thing on their own branch
 * and compare like for like.
 *
 * Keep them **short and legible** — a few seconds, one idea. A recording that
 * wanders is a recording nobody scrubs. And keep every step tolerant: a flow that
 * throws mid-record yields a truncated video and no explanation, so a step that
 * can't find its target should narrate and move on rather than fail the run.
 */

export interface Interaction {
  /** Filename stem and the name passed on the command line. */
  name: string
  description: string
  /** Where the flow starts. */
  path: string
  viewport?: { width: number; height: number }
  /** Cookies set before the first navigation — same mechanism as a Screen's,
   *  for flows that start with a panel already open. */
  cookies?: Array<{ name: string; value: string }>
  /** Runs before the first navigation — same hook as a Screen's. */
  beforeNavigate?: (page: Page) => Promise<void>
  /** The flow itself. `page` is already loaded at `path` and settled. */
  run: (page: Page) => Promise<void>
}

const ids = FIXTURE_IDS

export const INTERACTIONS: Interaction[] = [
  {
    name: "open-canvas",
    description: "Home → open a Canvas → the canvas paints its Groups.",
    path: "/",
    run: async (page) => {
      await click(
        page,
        page.getByText("Checkout flow", { exact: false }).first()
      )
      await page
        .waitForURL(`**/${ids.rooms.checkout}`, { timeout: 30_000 })
        .catch(() => {})
      await page.waitForTimeout(3500)
    },
  },
  {
    name: "canvas-loading",
    description:
      "Opening a Canvas by URL on a slow connection: the loading skeleton, then the Canvas fading in over it.",
    path: "/",
    run: async (page) => {
      // Locally the Canvas answers in milliseconds, which is too fast to
      // review. Add latency to every request so the skeleton has a few seconds
      // on screen, as it would on a slow machine. A full load rather than a
      // click from home: `next dev` doesn't prefetch, so a soft navigation
      // would sit on the home page instead of showing the loading state.
      const cdp = await page.context().newCDPSession(page)
      await cdp.send("Network.enable")
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 800,
        downloadThroughput: -1,
        uploadThroughput: -1,
      })
      await page
        .goto(`/${ids.rooms.checkout}`, { timeout: 60_000 })
        .catch(() => {})
      await page.waitForTimeout(6000)
    },
  },
  {
    name: "canvas-zoom",
    description: "Zooming and panning the reference Canvas.",
    path: `/${ids.rooms.checkout}`,
    run: async (page) => {
      const box = page.viewportSize() ?? DEFAULT_VIEWPORT
      const cx = box.width / 2
      const cy = box.height / 2
      await page.mouse.move(cx, cy)
      // Ctrl+wheel is the canvas's zoom gesture; a bare wheel pans.
      for (let i = 0; i < 12; i++) {
        await page.keyboard.down("Control")
        await page.mouse.wheel(0, -40)
        await page.keyboard.up("Control")
        await page.waitForTimeout(60)
      }
      await page.waitForTimeout(500)
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(60, 30)
        await page.waitForTimeout(60)
      }
      await page.waitForTimeout(1200)
    },
  },
  {
    name: "agent-chat",
    description: "Scrolling back through a finished agent turn.",
    path: `/${ids.rooms.checkout}`,
    // Start with the panel already open, so the recording is the scroll rather
    // than a click on a panel toggle.
    cookies: canvasPanels({ chatPct: 30 }),
    run: async (page) => {
      // Scroll the log rather than the window: the chat panel is its own
      // scroll container, so park the pointer over it first.
      const box = page.viewportSize() ?? DEFAULT_VIEWPORT
      await page.mouse.move(box.width - box.width * 0.15, box.height / 2)
      await page.waitForTimeout(800)
      for (let i = 0; i < 6; i++) {
        await page.mouse.wheel(0, -180)
        await page.waitForTimeout(160)
      }
      await page.waitForTimeout(1200)
    },
  },
  {
    name: "theme-toggle",
    description: "Settings → flipping appearance from light to dark and back.",
    path: "/settings",
    run: async (page) => {
      await click(page, page.getByRole("button", { name: /^dark$/i }).first())
      await page.waitForTimeout(1500)
      await click(page, page.getByRole("button", { name: /^light$/i }).first())
      await page.waitForTimeout(1500)
    },
  },
  {
    name: "browse-folders",
    description: "Walking the Folder tree from All files into a nested Folder.",
    path: "/files",
    run: async (page) => {
      await click(
        page,
        page.getByText("Design system", { exact: false }).first()
      )
      await page.waitForTimeout(1500)
      await click(page, page.getByText("Archive", { exact: false }).first())
      await page.waitForTimeout(1500)
      await page.goBack()
      await page.waitForTimeout(1200)
    },
  },
]

/**
 * Click a target if it is there, and say so if it isn't. A recording is a
 * best-effort artifact — a missing affordance should leave a usable (if shorter)
 * video plus a line in the log, not abort the run.
 */
async function click(
  page: Page,
  locator: ReturnType<Page["locator"]>
): Promise<void> {
  try {
    await locator.click({ timeout: 10_000 })
  } catch {
    console.warn(`  ! skipped a step: could not click ${locator}`)
  }
}

/** Look up one interaction by name. Throws with the known names on a miss. */
export function selectInteraction(name: string): Interaction {
  const found = INTERACTIONS.find((i) => i.name === name)
  if (!found) {
    throw new Error(
      `unknown interaction: ${name}\nknown interactions: ${INTERACTIONS.map((i) => i.name).join(", ")}`
    )
  }
  return found
}
