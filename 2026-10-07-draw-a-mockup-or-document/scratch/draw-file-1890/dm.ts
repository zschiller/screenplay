import type { Page } from "playwright-core"
import { ids } from "../helpers"
import type { Screen } from "../screen"

const BOX = { x1: 760, y1: 200, x2: 1160, y2: 700 }

let slotN = 0
async function draw(page: Page, key: string, typed?: string, slot = 0) {
  await page.waitForTimeout(2000)
  await page.mouse.click(5, 500)
  await page.keyboard.press("Escape")
  await page.mouse.move(900, 500)
  const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"))
  await page.mouse.wheel(900 + (slot * 2 + (dark ? 1 : 0)) * 700, 0)
  await page.waitForTimeout(500)
  await page.keyboard.press(key)
  await page.mouse.move(BOX.x1, BOX.y1)
  await page.mouse.down()
  await page.mouse.move(BOX.x2 - 50, BOX.y2 - 50, { steps: 8 })
  await page.mouse.move(BOX.x2, BOX.y2, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(700)
  if (typed) {
    await page.keyboard.type(typed)
    await page.waitForTimeout(300)
  }
}

const path = `/${ids.rooms.checkout}`
const screens: Screen[] = [
  { name: "dm-frame", description: "drawn frame card", path, prepare: (p) => draw(p, "f", undefined, 11) },
  { name: "dm-mockup", description: "drawn mockup card", path, prepare: (p) => draw(p, "m") },
  { name: "dm-document", description: "drawn document card", path, prepare: (p) => draw(p, "d", undefined, 1) },
]
export default screens

const ls = (vals: Record<string, string>) => async (page: Page) => {
  await page.addInitScript((v) => {
    for (const [k, val] of Object.entries(v)) localStorage.setItem(k, val)
  }, vals)
}
for (const kind of ["mockup", "document"] as const) {
  const key = kind === "mockup" ? "m" : "d"
  for (const v of ["a", "b"]) {
    const slot = ++slotN + 1
    screens.push({ name: `dm-${kind}-${v}`, description: `${kind} ${v}`, path, beforeNavigate: ls({ dmx: v }), prepare: (p) => draw(p, key, undefined, slot) })
  }
  screens.push({ name: `dm-${kind}-files`, description: `${kind} files`, path, beforeNavigate: ls({ dmx: "a", "dmx-files": "1" }), prepare: (p) => draw(p, key, undefined, kind === "mockup" ? 7 : 8) })
  screens.push({ name: `dm-${kind}-typed`, description: `${kind} files typed`, path, beforeNavigate: ls({ dmx: "a", "dmx-files": "1" }), prepare: (p) => draw(p, key, kind === "mockup" ? "opt" : "brief", kind === "mockup" ? 9 : 10) })
}
