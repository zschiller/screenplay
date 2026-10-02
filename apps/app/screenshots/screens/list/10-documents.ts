import type { Screen } from "../screen"
import {
  canvasPanels,
  ids,
  showTooltip,
  replyInChatFromBrief,
} from "../helpers"

const screens: Screen[] = [
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
    name: "canvas-document-reply-in-chat",
    description:
      "Reply in chat (#1243): a Document line quoted into the Checkout polish chat's composer, a question typed under it.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: replyInChatFromBrief,
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
        .getByRole("button", { name: "Collapse sidebar" })
        .first()
        .hover({ timeout: 15_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
]

export default screens
