// EXPLORATION scratch: scrim options and the pending Mockup box.
import { resolveCaptureProfile } from "../../profile"
import { launchBrowser, openThemedContext, settle } from "../../lib/browser"
import { canvasPanels } from "../helpers"

const OUT = process.env.OUT!
const OPTS = (process.env.OPTS ?? "s,f").split(",")
const THEMES = (process.env.THEMES ?? "light,dark").split(",") as ("light" | "dark")[]
const VW = 1440, VH = 900

type Scene = { name: string; room: string; layer?: string; zoom: number; mockupBox?: { x: number; y: number; width: number; height: number }; via?: "button" | "api" }
const SCENES: Scene[] = [
  { name: "empty", room: "room-frame-states", layer: "layer-empty-desktop", zoom: 0.75, via: "button" },
  { name: "live", room: "room-frame-states", layer: "layer-frames-ready", zoom: 2, via: "api" },
  { name: "mockup", room: "room-checkout-flow", layer: "mockup-cart-suggestions", zoom: 0.75, via: "api" },
  { name: "pending-mockup", room: "room-frame-states", zoom: 0.75, mockupBox: { x: 1900, y: 0, width: 1280, height: 800 } },
]

async function main() {
  const profile = resolveCaptureProfile()
  const browser = await launchBrowser()
  for (const theme of THEMES) for (const opt of OPTS) {
    const [fsk, fsm = ""] = opt.split("+")
    const ctx = await openThemedContext(browser, profile, { viewport: { width: VW, height: VH }, theme, cookies: canvasPanels({ sidebarPct: 0, chatPct: 0 }) })
    await ctx.addInitScript(`try{localStorage.setItem("fsx","b");localStorage.setItem("fsk",${JSON.stringify(fsk)});localStorage.setItem("fsm",${JSON.stringify(fsm)})}catch(e){}`)
    const page = await ctx.newPage()
    for (const sc of SCENES.filter((s) => !process.env.SCENES || process.env.SCENES.split(",").includes(s.name))) {
      await page.goto("/" + sc.room)
      await settle(page, { freeze: false })
      await page.waitForFunction("!!window.__canvasCamera && !!window.__askFrame")
      await page.evaluate("window.__canvasCamera.setTransform(0,0,1)")
      await page.waitForTimeout(500)
      let c: { x: number; y: number }
      if (sc.mockupBox) {
        const b = sc.mockupBox
        c = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
        // canvas origin offset at (0,0,1)
        const o = (await page.evaluate(`(() => { const w=document.querySelector('[data-canvas-wrapper]').getBoundingClientRect(); const r=document.querySelector('.react-transform-component').getBoundingClientRect(); return {x:r.x-w.x,y:r.y-w.y} })()`)) as { x: number; y: number }
        void o
      } else {
        c = (await page.evaluate(`(() => { const o=document.querySelector('.react-transform-component').getBoundingClientRect(); const r=document.querySelector('[data-layer-id="${sc.layer}"]').getBoundingClientRect(); return {x:r.x-o.x+r.width/2,y:r.y-o.y+r.height/2} })()`)) as { x: number; y: number }
      }
      await page.evaluate(`window.__canvasCamera.setTransform(${VW / 2 - c.x * sc.zoom}, ${VH / 2 - c.y * sc.zoom}, ${sc.zoom})`)
      await page.waitForTimeout(1500)
      if (sc.mockupBox) {
        await page.evaluate(`window.__askMockup(${JSON.stringify(sc.mockupBox)})`)
      } else if (sc.via === "button") {
        await page.evaluate(`(() => { const btn=[...document.querySelectorAll('[data-layer-id="${sc.layer}"] [data-frame-stage] button')].find(b=>/Start a chat/.test(b.textContent)); btn && btn.click() })()`)
      } else {
        await page.evaluate(`window.__askFrame(${JSON.stringify(sc.layer)}, ${JSON.stringify(sc.name === "mockup" ? "Message the chat that made this mockup" : "Message this frame’s chat")})`)
      }
      await page.waitForTimeout(900)
      await page.mouse.move(3, 3)
      await page.screenshot({ path: `${OUT}/${opt.replace("+", "-") || "today"}.${sc.name}.${theme}.png` })
    }
    await ctx.close()
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
