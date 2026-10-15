import { launchBrowser, openThemedContext, settle } from "../../lib/browser"
import { resolveCaptureProfile } from "../../profile"
import { canvasPanels, ids, selectWorkspace } from "../helpers"
import { peer, measure } from "./pb-lib"

const OUT = process.env.OUT!
async function main() {
  const profile = resolveCaptureProfile()
  const browser = await launchBrowser()
  const p = await peer(ids.rooms.checkout)
  const id = ids.branches.checkoutPolish
  const orig = p.get(id)!
  console.log("orig", orig.status, orig.codeReady)
  const states: Record<string, Partial<typeof orig>> = {
    running: {},
    booting: { status: "creating", statusMessage: "Cloning repository…", codeReady: false },
    codeready: { status: "creating", statusMessage: "Installing dependencies…", codeReady: true },
  }
  try {
    for (const theme of ["light"] as const) {
      const ctx = await openThemedContext(browser, profile, { viewport: { width: 1512, height: 982 }, theme, cookies: canvasPanels({ chatPct: 30 }) })
      const page = await ctx.newPage()
      await page.goto(`/${ids.rooms.checkout}`, { waitUntil: "domcontentloaded", timeout: 120000 })
      await settle(page, { freeze: false })
      await selectWorkspace(page, "Checkout polish")
      for (const [name, patch] of Object.entries(states)) {
        p.patch(id, { status: orig.status, statusMessage: orig.statusMessage, codeReady: orig.codeReady, ...patch })
        await page.waitForTimeout(2500)
        await page.mouse.move(0, 0)
        console.log(name, JSON.stringify(await measure(page)))
        await page.screenshot({ path: `${OUT}/today-${name}.${theme}.png`, clip: { x: 1050, y: 0, width: 462, height: 982 } })
      }
      await ctx.close()
    }
  } finally {
    p.patch(id, { status: orig.status, statusMessage: orig.statusMessage, codeReady: orig.codeReady })
    await new Promise((r) => setTimeout(r, 500))
    p.close()
    await browser.close()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
