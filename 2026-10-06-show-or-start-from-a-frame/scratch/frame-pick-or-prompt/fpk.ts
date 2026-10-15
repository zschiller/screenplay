// EXPLORATION scratch: frame ask card variants (localStorage fpk).
import { resolveCaptureProfile } from "../../profile"
import { launchBrowser, openThemedContext, settle } from "../../lib/browser"
import { canvasPanels } from "../helpers"

const OUT = process.env.OUT!
const OPTS = (process.env.OPTS ?? "today").split(",")
const THEMES = (process.env.THEMES ?? "light,dark").split(",") as ("light" | "dark")[]
const MODE = process.env.MODE ?? "ask" // overview | ask | chip | typed | shown
const CAM = process.env.CAM ?? "0,0,0.5"
const VW = Number(process.env.VW ?? 1280), VH = Number(process.env.VH ?? 800)
const DRAW = (process.env.DRAW ?? "760,180,940,560").split(",").map(Number)
const TYPE = process.env.TYPE ?? ""

async function main() {
  const profile = resolveCaptureProfile()
  const browser = await launchBrowser()
  for (const theme of THEMES) for (const opt of OPTS) {
    const ctx = await openThemedContext(browser, profile, { viewport: { width: VW, height: VH }, theme, cookies: canvasPanels({ sidebarPct: 0, chatPct: 0 }) })
    await ctx.addInitScript(`try{localStorage.setItem("fpk",${JSON.stringify(opt)});localStorage.setItem("fpp",${JSON.stringify(process.env.FPP ?? "")})}catch(e){}`)
    const page = await ctx.newPage()
    await page.goto("/room-checkout-flow")
    await settle(page, { freeze: false })
    await page.waitForFunction("!!window.__canvasCamera")
    await page.evaluate(`window.__canvasCamera.setTransform(${CAM})`)
    await page.waitForTimeout(1500)
    if (MODE !== "overview") {
      await page.mouse.click(DRAW[0] - 40, DRAW[1] - 40)
      if (process.env.PRESELECT) {
        const [px, py] = process.env.PRESELECT.split(",").map(Number)
        await page.mouse.click(px, py)
        await page.waitForTimeout(400)
      }
      await page.keyboard.press("f")
      await page.mouse.move(DRAW[0], DRAW[1])
      await page.mouse.down()
      await page.mouse.move((DRAW[0] + DRAW[2]) / 2, (DRAW[1] + DRAW[3]) / 2, { steps: 8 })
      await page.mouse.move(DRAW[2], DRAW[3], { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(700)
      if (process.env.PRETAB) {
        await page.getByRole("tab", { name: process.env.PRETAB }).click()
        await page.waitForTimeout(400)
        await page.locator("[role=dialog] [contenteditable]").first().click()
      }
      if (TYPE && ["c", "d", "e", "k", "l"].includes(opt)) await page.locator("[role=dialog] [cmdk-input]").click()
      if (TYPE) await page.keyboard.type(TYPE, { delay: 10 })
      if (MODE === "enter") {
        await page.keyboard.press("Enter")
        await page.waitForTimeout(800)
      }
      if (MODE === "showbtn") {
        await page.getByRole("button", { name: "Show a chat" }).click()
        await page.waitForTimeout(500)
      }
      if (MODE === "chip") {
        await page.getByRole("button", { name: "Who answers" }).click()
        await page.waitForTimeout(500)
      }
      if (MODE === "picked") {
        await page.getByRole("button", { name: "Who answers" }).click()
        await page.waitForTimeout(400)
        await page.locator("[cmdk-item]").filter({ hasText: "Checkout polish" }).first().click()
        await page.waitForTimeout(400)
      }
      if (MODE === "hover") {
        await page.locator("[role=dialog] [cmdk-item], [role=dialog] [data-preview-row]").first().hover()
        await page.waitForTimeout(300)
      }
      if (MODE === "shown") {
        await page.locator("[role=dialog] [cmdk-item], [role=dialog] [data-preview-row]").filter({ hasText: "Empty cart" }).first().click()
        await page.waitForTimeout(3000)
      }
      if (MODE !== "hover") await page.mouse.move(3, VH - 3)
      await page.waitForTimeout(400)
    }
    await page.waitForTimeout(Number(process.env.WAIT ?? 0))
    await page.screenshot({ path: `${OUT}/${opt || "today"}.${process.env.NAME ?? MODE}.${theme}.png` })
    // Leave the room as it was: delete the drawn frame.
    if (MODE !== "overview") {
      await page.keyboard.press("Escape")
      await page.mouse.click((DRAW[0] + DRAW[2]) / 2, DRAW[1] + 30)
      await page.keyboard.press("Delete")
      await page.waitForTimeout(500)
    }
    await ctx.close()
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
