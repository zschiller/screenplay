// EXPLORATION scratch: shoot the frame empty state across zooms and options.
import { resolveCaptureProfile } from "../../profile"
import { launchBrowser, openThemedContext, settle } from "../../lib/browser"
import { canvasPanels } from "../helpers"

const OUT = process.env.OUT!
const OPTS = (process.env.OPTS ?? "today,a,b,c").split(",")
const THEMES = (process.env.THEMES ?? "light,dark").split(",") as ("light" | "dark")[]
const ZOOMS = (process.env.ZOOMS ?? "2,1,0.5,0.25,0.1").split(",").map(Number)
const FRAMES = (process.env.FRAMES ?? "layer-empty-desktop,layer-empty-phone,layer-empty-narrow,layer-empty-small").split(",")
const VW = 1600, VH = 1000, CW = 720, CH = 450

async function main() {
  const profile = resolveCaptureProfile()
  const browser = await launchBrowser()
  for (const theme of THEMES) {
    const ctx = await openThemedContext(browser, profile, {
      viewport: { width: VW, height: VH },
      theme,
      cookies: canvasPanels({ sidebarPct: 0, chatPct: 0 }),
    })
    const page = await ctx.newPage()
    for (const opt of OPTS) {
      await page.addInitScript(`try{localStorage.setItem("fsx",${JSON.stringify(opt)})}catch(e){}`)
      await page.goto("/room-frame-states")
      await settle(page, { freeze: false })
      await page.waitForFunction("!!window.__canvasCamera")
      await page.evaluate(`localStorage.setItem("fsx",${JSON.stringify(opt)})`)
      await page.reload()
      await settle(page, { freeze: false })
      await page.waitForFunction("!!window.__canvasCamera")
      // Canvas coords of each frame: at (0,0,1), screen rect minus canvas origin.
      await page.evaluate("window.__canvasCamera.setTransform(0,0,1)")
      await page.waitForTimeout(400)
      const origin = await page.evaluate(`(() => { const r = document.querySelector('[data-frame-stage]').closest('.react-transform-component')?.getBoundingClientRect(); return r ? {x:r.x,y:r.y} : null })()`)
      for (const id of FRAMES) {
        const rect = await page.evaluate(`(() => { const els=[...document.querySelectorAll('[data-frame-stage=unassigned]')]; const r = els.map(e=>e.getBoundingClientRect()); return r })()`)
        void rect
        const box = await page.evaluate(`(() => { const el=document.querySelector('[data-layer-id="${id}"] [data-frame-stage], [data-iframe-layer-id="${id}"] [data-frame-stage]'); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height} })()`) as null | { x: number; y: number; w: number; h: number }
        if (!box || !origin) { console.warn("no box", id, origin); continue }
        const o = origin as { x: number; y: number }
        const cx = box.x - o.x + box.w / 2, cy = box.y - o.y + box.h / 2
        for (const z of ZOOMS) {
          await page.evaluate(`window.__canvasCamera.setTransform(${VW / 2 - cx * z}, ${VH / 2 - cy * z}, ${z})`)
          await page.waitForTimeout(500)
          await page.mouse.move(5, 5)
          await page.screenshot({
            path: `${OUT}/${opt}.${id.replace("layer-empty-", "")}.${Math.round(z * 100)}.${theme}.png`,
            clip: { x: (VW - CW) / 2, y: (VH - CH) / 2, width: CW, height: CH },
          })
        }
        await page.evaluate("window.__canvasCamera.setTransform(0,0,1)")
        await page.waitForTimeout(300)
      }
    }
    await ctx.close()
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
