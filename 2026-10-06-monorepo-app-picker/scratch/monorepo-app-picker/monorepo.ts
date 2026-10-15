import type { Page } from "playwright-core"
import { appendFileSync } from "node:fs"
import type { Screen } from "../screen"
import { ids, openAddProject } from "../helpers"

async function configure(page: Page, path: string) {
  await openAddProject(page, "folder")
  const input = page.locator("[role=dialog] input").first()
  await input.fill(path)
  await page.locator("[role=dialog] button").filter({ hasText: /^Add$/ }).first().click()
  await page.getByText("Configure repository").waitFor({ timeout: 20_000 })
  await page.getByText("Detecting settings").waitFor({ state: "detached", timeout: 45_000 }).catch(() => {})
  await page.waitForTimeout(800)
}

async function measure(page: Page, label: string) {
  const m = await page.evaluate(`(() => {
    const d = [...document.querySelectorAll("[role=dialog]")].pop()
    const r = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] }
    const out = { dialog: r(d), fields: [] }
    for (const el of d.querySelectorAll("label, input, textarea, button, h2, p")) {
      const cs = getComputedStyle(el)
      out.fields.push({ tag: el.tagName, text: (el.innerText || el.value || "").slice(0, 60), box: r(el), font: cs.fontSize })
    }
    return out
  })()`)
  appendFileSync("/tmp/claude-0/-home-user-screenplay/a8a49d29-03fe-50c9-8dbd-b70d13822d29/scratchpad/measure.jsonl", JSON.stringify({ label, ...(m as object) }) + "\n")
}

const screens: Screen[] = [
  {
    name: "mono-today",
    description: "Configure repository for the screenplay monorepo.",
    path: `/${ids.rooms.checkout}`,
    viewport: { width: 1280, height: 1000 },
    prepare: async (page) => { await configure(page, "/home/user/screenplay"); await measure(page, "today") },
    settleMs: 300,
  },
  {
    name: "mono-today-advanced",
    description: "Same, Advanced open.",
    path: `/${ids.rooms.checkout}`,
    viewport: { width: 1280, height: 1000 },
    prepare: async (page) => {
      await configure(page, "/home/user/screenplay")
      await page.getByRole("button", { name: "Advanced" }).click()
      await page.waitForTimeout(500)
      await measure(page, "advanced")
    },
    settleMs: 300,
  },
]
export default screens
