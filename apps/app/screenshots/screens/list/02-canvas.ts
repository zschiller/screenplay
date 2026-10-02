import type { Page } from "playwright-core"

import type { Screen } from "../screen"
import { holdYjsConnection, canvasPanels, ids, openChatTab } from "../helpers"

const screens: Screen[] = [
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
    name: "canvas-mockups",
    description:
      "Mockup Layers: two options beside the live empty cart (one selected), and a standalone receipt.",
    path: `/${ids.rooms.checkout}`,
    // Wide enough to show both Groups beside the chat panel.
    viewport: { width: 2100, height: 560 },
    prepare: async (page) => {
      // Frame the "Empty cart ideas" and "Receipt" Groups (world y 2200).
      await page.waitForFunction("!!window.__canvasCamera", undefined, {
        timeout: 15_000,
      })
      await page.evaluate("window.__canvasCamera.setTransform(30, -472, 0.26)")
      // Select Option A by clicking its page, the way any layer selects.
      await page.mouse.click(780, 250)
    },
    settleMs: 800,
  },
  {
    name: "canvas-mockup-status",
    description:
      "A Mockup's status menu (#1310) open on Option B · Suggestions: Set aside, Current (checked) and Built.",
    path: `/${ids.rooms.checkout}`,
    viewport: { width: 2100, height: 560 },
    prepare: async (page) => {
      await page.waitForFunction("!!window.__canvasCamera", undefined, {
        timeout: 15_000,
      })
      await page.evaluate("window.__canvasCamera.setTransform(30, -472, 0.26)")
      await page.getByRole("button", { name: "Status: Current" }).click()
    },
    settleMs: 400,
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
]

export default screens

/**
 * Make the Canvas throw as it mounts, so the route's error boundary catches it.
 *
 * The fixture world can't make the server render fail on demand, but the route
 * has one boundary for the server render and the client Canvas alike, so any
 * throw inside it paints the same page. `ResizeObserver` is constructed by the
 * panel layout on mount and nowhere before the Canvas, so failing it reaches
 * exactly that boundary and nothing earlier.
 */
async function breakCanvasMount(page: Page): Promise<void> {
  await page.addInitScript(`
    window.ResizeObserver = class {
      constructor() {
        throw new Error("screenshot harness: simulated Canvas failure")
      }
    }
  `)
}
