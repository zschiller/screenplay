import { appendFileSync } from "node:fs"
import type { Page } from "playwright-core"

import { type Screen } from "../screen"
import { ids, selectCheckoutFrame } from "../helpers"

const OUT =
  "/tmp/claude-0/-home-user-screenplay/f9ed0566-c39f-5501-b7bf-6bbfae29d4c3/scratchpad/fm/boxes.jsonl"

const shots: Array<[string, string, string[]]> = [
  ["today", "menu", []],
  ["today", "chat", ["Chat"]],
  ["today", "restart", ["Chat", "Restart"]],
  ["a", "preview", ["Preview"]],
  ["b", "menu", []],
  ["b", "preview", ["Preview"]],
  ["b", "chat", ["Chat"]],
  ["c", "menu", []],
  ["c", "chat", ["Chat"]],
  ["c", "restart", ["Restart"]],
  ["d", "menu", []],
  ["d", "restart", ["Restart"]],
  ["e", "preview", ["Preview"]],
  ["e", "chat", ["Chat"]],
  ["e", "restart", ["Preview", "Restart"]],
  ["ra", "restart", ["Preview", "Restart"]],
  ["rb", "restart", ["Preview", "Restart"]],
  ["rc", "preview", ["Preview"]],
  ["la", "preview", ["Preview"]],
  ["lb", "preview", ["Preview"]],
  ["lc", "preview", ["Prototype"]],
  ["ld", "preview", ["Dev server"]],
]

async function record(page: Page, name: string) {
  await page.waitForTimeout(600)
  const data = await page.evaluate(() =>
    [...document.querySelectorAll("[role=menu]")].map((m) => {
      const r = m.getBoundingClientRect()
      return {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        items: [...m.querySelectorAll("[role^=menuitem],[role=separator]")]
          .filter((i) => i.closest("[role=menu]") === m)
          .map((i) =>
            i.getAttribute("role") === "separator"
              ? "—"
              : `${(i as HTMLElement).innerText.trim()}${i.getAttribute("aria-disabled") === "true" || i.hasAttribute("data-disabled") ? " (disabled)" : ""}`
          ),
        rowH: (() => {
          const i = m.querySelector("[role^=menuitem]")
          return i ? i.getBoundingClientRect().height : 0
        })(),
      }
    })
  )
  const theme = await page.evaluate(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light"
  )
  appendFileSync(OUT, JSON.stringify({ name, theme, menus: data }) + "\n")
}

export default shots.map(
  ([opt, shot, path]): Screen => ({
    name: `fm-${opt}-${shot}`,
    description: `Frame menu, option ${opt}, ${shot}`,
    path: `/${ids.rooms.checkout}`,
    viewport: { width: 1440, height: 1000 },
    hosted: (opt === "e" && shot === "restart") || opt.startsWith("r"),
    beforeNavigate: async (page) => {
      await page.addInitScript(
        `try{localStorage.setItem("frame-menu-opt", ${JSON.stringify(/^[lr]/.test(opt) ? "e" : opt)});localStorage.setItem("frame-menu-label", ${JSON.stringify(opt.startsWith("l") ? opt.slice(1) : "a")});localStorage.setItem("frame-menu-restart", ${JSON.stringify(opt.startsWith("r") ? opt.slice(1) : "today")})}catch{}`
      )
    },
    prepare: async (page) => {
      await selectCheckoutFrame(page)
      await page
        .locator("#frame-toolbar-portal")
        .getByRole("button", { name: "Frame options" })
        .click({ timeout: 15_000 })
      for (const item of path) {
        await page
          .locator("[role=menu]")
          .last()
          .getByRole("menuitem", { name: item, exact: true })
          .hover({ timeout: 10_000 })
        await page.waitForTimeout(700)
      }
      await record(page, `fm-${opt}-${shot}`)
    },
    settleMs: 300,
  })
)
