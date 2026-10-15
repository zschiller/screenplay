// EXPLORATION scratch: the chat prompt card over the empty state.
import { resolveCaptureProfile } from "../../profile"
import { launchBrowser, openThemedContext, settle } from "../../lib/browser"
import { canvasPanels } from "../helpers"

const OUT = process.env.OUT!
const OPTS = (process.env.OPTS ?? "today").split(",")
const THEMES = (process.env.THEMES ?? "light,dark").split(",") as ("light" | "dark")[]
const VW = 1440, VH = 900
const CASES: [string, number][] = (process.env.CASES ?? "desktop:1,desktop:0.5,desktop:0.25,phone:1,phone:0.5,narrow:1,small:1,small:2").split(",").map((c) => { const [f, z] = c.split(":"); return [f, Number(z)] })

async function main() {
  const profile = resolveCaptureProfile()
  const browser = await launchBrowser()
  for (const theme of THEMES) for (const opt of OPTS) {
    const ctx = await openThemedContext(browser, profile, { viewport: { width: VW, height: VH }, theme, cookies: canvasPanels({ sidebarPct: 0, chatPct: 0 }) })
    const [fsx, fsk = ""] = opt.split("+")
    await ctx.addInitScript(`try{localStorage.setItem("fsx",${JSON.stringify(fsx)});localStorage.setItem("fsk",${JSON.stringify(fsk)})}catch(e){}`)
    const page = await ctx.newPage()
    await page.goto("/room-frame-states")
    await settle(page, { freeze: false })
    await page.waitForFunction("!!window.__canvasCamera")
    for (const [f, z] of CASES) {
      await page.keyboard.press("Escape")
      await page.evaluate("window.__canvasCamera.setTransform(0,0,1)")
      await page.waitForTimeout(400)
      const b = (await page.evaluate(`(() => { const o=document.querySelector('.react-transform-component').getBoundingClientRect(); const r=document.querySelector('[data-layer-id="layer-empty-${f}"] [data-frame-stage]').getBoundingClientRect(); return {x:r.x-o.x+r.width/2,y:r.y-o.y+r.height/2} })()`)) as { x: number; y: number }
      await page.evaluate(`window.__canvasCamera.setTransform(${VW / 2 - b.x * z}, ${VH / 2 - b.y * z}, ${z})`)
      await page.waitForTimeout(500)
      const ok = await page.evaluate(`(() => { const btn=[...document.querySelectorAll('[data-layer-id="layer-empty-${f}"] [data-frame-stage] button')].find(b=>/Start a chat/.test(b.textContent)); if(!btn) return false; btn.click(); return true })()`)
      if (!ok) console.warn("no button", f, z)
      await page.waitForTimeout(700)
      await page.mouse.move(3, 3)
      await page.screenshot({ path: `${OUT}/${opt.replace("+", "-")}.ask-${f}-${Math.round(z * 100)}.${theme}.png` })
    }
    await ctx.close()
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
