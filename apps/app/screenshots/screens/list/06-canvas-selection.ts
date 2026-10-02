import type { Page } from "playwright-core"

import { settle } from "../../lib/browser"
import type { Screen } from "../screen"
import { ids } from "../helpers"

const screens: Screen[] = [
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
]

export default screens

/**
 * Open the same Canvas in a second tab of the capture's context, so it joins the
 * room as another presence (same user, its own awareness client), and park its
 * pointer — optionally with a cursor-chat message — at a screen position.
 *
 * `paletteIndex` picks the presence colour out of the camera's fixed palette by
 * pinning that tab's `Math.random`, since a random swatch would make before and
 * after captures disagree.
 */
async function addPeer(
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
