import type { Page } from "playwright-core"
import { ids } from "../helpers"
import type { Screen } from "../screen"

async function draw(page: Page) {
  await page.mouse.click(5, 500)
  await page.keyboard.press("Escape")
  await page.mouse.move(900, 500)
  await page.mouse.wheel(760, 0)
  await page.waitForTimeout(500)
  await page.keyboard.press("f")
  await page.mouse.move(DRAW.x1, DRAW.y1)
  await page.mouse.down()
  await page.mouse.move(DRAW.x2 - 50, DRAW.y2 - 50, { steps: 8 })
  await page.mouse.move(DRAW.x2, DRAW.y2, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(600)
}
const DRAW = JSON.parse(process.env.DRAW ?? '{"x1":900,"y1":160,"x2":1240,"y2":700}')

const screens: Screen[] = [
  { name: "d-canvas", description: "canvas", path: `/${ids.rooms.checkout}`, prepare: async (page) => { await page.mouse.move(900, 500); await page.mouse.wheel(760, 0); await page.waitForTimeout(500) } },
  { name: "d-card", description: "drawn frame card", path: `/${ids.rooms.checkout}`, prepare: draw },
  {
    name: "d-chip", description: "chip menu open", path: `/${ids.rooms.checkout}`,
    prepare: async (page) => { await draw(page); await page.mouse.click(938, 448); await page.waitForTimeout(400) },
  },
  {
    name: "d-esc", description: "after esc", path: `/${ids.rooms.checkout}`,
    prepare: async (page) => { await draw(page); await page.keyboard.press("Escape"); await page.waitForTimeout(400) },
  },
  {
    name: "d-title", description: "choose a chat menu", path: `/${ids.rooms.checkout}`,
    prepare: async (page) => { await draw(page); await page.keyboard.press("Escape"); await page.waitForTimeout(300); await page.getByRole("button", { name: "Choose a chat" }).last().click({ force: true }); await page.waitForTimeout(400) },
  },
]
export default screens
