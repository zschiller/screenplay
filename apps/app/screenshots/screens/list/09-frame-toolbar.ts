import type { Screen } from "../screen"
import {
  ids,
  checkoutDesktopFrame,
  showTooltip,
  selectCheckoutFrame,
} from "../helpers"

const screens: Screen[] = [
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
        .locator("#frame-toolbar-portal")
        .getByRole("button", { name: "Interact" })
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
      await page
        .locator("#frame-toolbar-portal")
        .getByRole("button", { name: "More" })
        .click({ timeout: 15_000 })
      await page
        .getByRole("menu")
        .first()
        .waitFor({ state: "visible", timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "canvas-frame-route-hover",
    description:
      "A selected frame's address bar with the route hovered: the same fill as the Workspace host, and an I-beam (#1149).",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await selectCheckoutFrame(page)
      await page
        .locator("#frame-toolbar-portal")
        .getByRole("button", { name: /^Route:/ })
        .hover({ timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "canvas-frame-route-field",
    description:
      "A selected frame's route edited in place with a route typed: the discovered routes that match and Go to, under the bar.",
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
    name: "canvas-frame-route-list",
    description:
      "A selected frame's route pressed, nothing typed: the route selected in place, every discovered route under the bar with the current one checked.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await selectCheckoutFrame(page)
      await page
        .locator("#frame-toolbar-portal")
        .getByRole("button", { name: /^Route:/ })
        .click({ timeout: 15_000 })
      await page
        .getByRole("listbox")
        .waitFor({ state: "visible", timeout: 15_000 })
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
          .locator("button:has(svg.ph-caret-up-down)")
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
]

export default screens
