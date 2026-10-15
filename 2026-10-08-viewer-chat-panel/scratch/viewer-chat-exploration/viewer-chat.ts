// EXPLORATION ONLY (#1933 viewer chat panel and canvas chrome): never committed.
// EXPLORE_OPT: comma list of today | q1a | q1b | q1c | q2a | q2b | q3a | q3b.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const TAG = readFileSync(join(import.meta.dirname, "viewer-chat-tag.js"), "utf8").replace("module.exports = ", "")
import type { Page } from "playwright-core"
import type { Screen } from "../screen"
import { canvasPanels, ids, selectWorkspace } from "../helpers"

const OPTS = (process.env.EXPLORE_OPT ?? "today").split(",")
const DUMP = process.env.EXPLORE_DUMP ?? ""

async function tag(page: Page) {
  await page.evaluate(`(${TAG})(${JSON.stringify(OPTS)})`)
  await page.addStyleTag({
    content: `
[data-x=hide],[aria-label="New page"],[aria-label="Canvas options"],[aria-label="Chat options"],[aria-label="Tools"],[aria-label="Choose a chat"]{display:none!important}
[data-x=note]{padding:14px 16px!important}
.x-note{margin:0;font-size:13px;line-height:20px;color:var(--muted-foreground);text-align:center}
[data-x=disabled-box]{opacity:.5;pointer-events:none}
[data-x=disabled-box] [contenteditable]{min-height:20px}
.x-wait{margin:0;font-size:13px;line-height:28px;color:var(--muted-foreground)}
.x-viewonly{display:inline-flex;align-items:center;gap:6px;margin-left:12px;padding-left:12px;border-left:1px solid var(--border);font-size:13px;color:var(--muted-foreground);white-space:nowrap}
`,
  })
  if (DUMP) {
    const boxes = await page.evaluate(`[...document.querySelectorAll("[data-x], [data-slot=composer], [aria-label=Tools]")].map((e) => { const r = e.getBoundingClientRect(); return { x: e.getAttribute("data-x"), slot: e.getAttribute("data-slot"), r: [r.x, r.y, r.width, r.height].map(Math.round) } })`)
    writeFileSync(DUMP, JSON.stringify(boxes))
  }
}

const screens: Screen[] = [
  {
    name: "vc-plan",
    description: "A chat paused on a plan, as a viewer would see it.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await selectWorkspace(page, "Empty cart state")
      await page.getByRole("button", { name: "Approve", exact: true }).waitFor({ timeout: 30_000 })
      await tag(page)
    },
    settleMs: 500,
  },
  {
    name: "vc-canvas",
    description: "The canvas chrome, chat panel closed.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page.locator('[aria-label="Tools"]').waitFor({ timeout: 30_000 })
      await tag(page)
    },
    settleMs: 500,
  },
]
export default screens
