// EXPLORATION scratch: group-wide shots and a zoom sweep video per option.
import { resolveCaptureProfile } from "../../profile"
import { launchBrowser, openThemedContext, settle } from "../../lib/browser"
import { canvasPanels } from "../helpers"
import { renameSync, readdirSync, mkdirSync } from "node:fs"

const OUT = process.env.OUT!
const OPTS = (process.env.OPTS ?? "today,a,b,c").split(",")
const THEMES = (process.env.THEMES ?? "light,dark").split(",") as ("light" | "dark")[]
const VIDEO = process.env.VIDEO === "1"
const VW = 1440, VH = 900

type Box = { x: number; y: number; w: number; h: number }

async function main() {
  const profile = resolveCaptureProfile()
  const browser = await launchBrowser()
  for (const theme of THEMES) for (const opt of OPTS) {
    const vdir = `${OUT}/vid-${opt}-${theme}`
    if (VIDEO) mkdirSync(vdir, { recursive: true })
    const ctx = await openThemedContext(browser, profile, {
      viewport: { width: VW, height: VH },
      theme,
      cookies: canvasPanels({ sidebarPct: 0, chatPct: 0 }),
      ...(VIDEO ? { recordVideoDir: vdir } : {}),
    })
    await ctx.addInitScript(`try{localStorage.setItem("fsx",${JSON.stringify(opt)})}catch(e){}`)
    const page = await ctx.newPage()
    const t0 = Date.now()
    let tStart = 0
    await page.goto("/room-frame-states")
    await settle(page, { freeze: false })
    await page.waitForFunction("!!window.__canvasCamera")
    await page.evaluate("window.__canvasCamera.setTransform(0,0,1)")
    await page.waitForTimeout(500)
    const boxes = (await page.evaluate(`(() => {
      const o = document.querySelector('.react-transform-component').getBoundingClientRect();
      const out = {};
      for (const id of ["desktop","phone","narrow","small"]) {
        const r = document.querySelector('[data-layer-id="layer-empty-'+id+'"] [data-frame-stage]').getBoundingClientRect();
        out[id] = {x:r.x-o.x,y:r.y-o.y,w:r.width,h:r.height};
      }
      return out })()`)) as Record<string, Box>
    const d = boxes.desktop, s = boxes.small
    const group = { cx: (d.x + s.x + s.w) / 2, cy: d.y + d.h / 2 }
    const ctr = (b: Box) => ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2 })
    const at = async (c: { cx: number; cy: number }, z: number) => {
      await page.evaluate(`window.__canvasCamera.setTransform(${VW / 2 - c.cx * z}, ${VH / 2 - c.cy * z}, ${z})`)
    }
    await page.mouse.move(3, 3)
    if (!VIDEO) {
      const shots: [string, { cx: number; cy: number }, number][] = [
        ["desk-200", ctr(d), 2],
        ["narrow-200", { cx: (boxes.narrow.x + boxes.small.x + boxes.small.w) / 2, cy: boxes.narrow.y + boxes.narrow.h / 2 }, 2],
        ["narrow-100", { cx: (boxes.phone.x + boxes.small.x + boxes.small.w) / 2, cy: boxes.phone.y + boxes.phone.h / 2 }, 1],
        ["group-50", group, 0.5],
        ["group-25", group, 0.25],
        ["group-10", group, 0.1],
      ]
      for (const [name, c, z] of shots) {
        await at(c, z)
        await page.waitForTimeout(600)
        await page.screenshot({ path: `${OUT}/${opt}.${name}.${theme}.png` })
      }
    } else {
      // Sweep 150% → 8% → 150% around the group, ~4s each way.
      const steps = 120
      await at(group, 1.5)
      await page.waitForTimeout(600)
      tStart = Date.now()
      await page.waitForTimeout(600)
      for (const dir of [1, -1]) {
        for (let i = 0; i <= steps; i++) {
          const t = dir === 1 ? i / steps : 1 - i / steps
          const z = Math.exp(Math.log(1.5) + (Math.log(0.08) - Math.log(1.5)) * t)
          await at(group, z)
          await page.waitForTimeout(30)
        }
        await page.waitForTimeout(800)
      }
    }
    await page.close()
    await ctx.close()
    if (VIDEO) {
      const f = readdirSync(vdir).find((n) => n.endsWith(".webm"))
      if (f) renameSync(`${vdir}/${f}`, `${OUT}/${opt}.zoom.${theme}.webm`)
      console.log(`START ${opt}.${theme} ${(tStart - t0) / 1000}`)
    }
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
