import { launchBrowser, openThemedContext, settle } from "../../lib/browser"
import { resolveCaptureProfile } from "../../profile"
import { canvasPanels, ids, selectWorkspace, openChatsMenu } from "../helpers"

const OUT = process.env.OUT!
async function main() {
  const profile = resolveCaptureProfile()
  const browser = await launchBrowser()
  const ctx = await openThemedContext(browser, profile, {
    viewport: { width: 1512, height: 982 }, theme: "light",
    cookies: canvasPanels({ chatPct: 30 }),
  })
  const page = await ctx.newPage()
  await page.goto(`/${ids.rooms.frameStates}`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await settle(page, { freeze: false })
  const menu = await openChatsMenu(page)
  console.log(await menu.innerText())
  await page.screenshot({ path: `${OUT}/menu.png` })
  await page.keyboard.press("Escape")
  for (let i = 0; i < 8; i++) {
    const m = await openChatsMenu(page)
    await m.waitFor(); for (let k = 0; k < i; k++) await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter")
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${OUT}/ws-${i}.png`, clip: { x: 1050, y: 0, width: 462, height: 982 } })
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
