import { writeFileSync, mkdirSync } from "node:fs"
import { launchBrowser, openThemedContext, settle } from "../../screenshots/lib/browser"
import { resolveCaptureProfile } from "../../screenshots/profile"
import { canvasPanels } from "../../screenshots/screens/helpers"

const OUT = process.argv[2] ?? ".screenshots/lx/out"
const css = process.env.LX_CSS ?? ""
const theme = (process.env.LX_THEME ?? "light") as "light" | "dark"
const shots = (process.env.LX_SHOTS ?? "").split(",").filter(Boolean).map(Number)
const sweep = (process.env.LX_SWEEP ?? "1") === "1"
mkdirSync(OUT, { recursive: true })

const READ = `(() => {
  const t = document.querySelector('.react-transform-component')
  const m = /scale\\(([0-9.e-]+)\\)/.exec(t.style.transform)
  const zoom = m ? +m[1] : NaN
  const layers = [...document.querySelectorAll('[data-layer-id]')].filter(e=>!e.parentElement.closest('[data-layer-id]')).map(e => { const r = e.getBoundingClientRect(); return { id: e.dataset.layerId, x: r.x, y: r.y, w: r.width, h: r.height } })
  const labels = [...document.querySelectorAll('[data-layer-label]')].map(e => {
    const vis = getComputedStyle(e).visibility !== 'hidden' && !e.hasAttribute('data-lx-hidden')
    const group0 = e.querySelector('.group\\\\/group-label'); const group = group0 && group0.getBoundingClientRect().width > 0 ? group0 : null
    const rows = [...e.querySelectorAll('[data-chat-hidden], .group\\\\/layer-label')]
    const chats = [...e.querySelectorAll('[data-label-chat]')].map(c => c.getBoundingClientRect().width > 0 && getComputedStyle(c).display !== 'none')
    const r = e.getBoundingClientRect()
    return { id: e.getAttribute('data-layer-label'), vis, text: e.innerText.replace(/\\s+/g,' ').trim(), group: !!group, groupText: group ? group.innerText.trim() : null, chats, compact: e.hasAttribute('data-compact'), x: r.x, y: r.y, w: r.width, h: r.height }
  })
  return { zoom, layers, labels }
})()`

async function main() {
  const profile = resolveCaptureProfile()
  const browser = await launchBrowser()
  const ctx = await openThemedContext(browser, profile, { viewport: { width: 1512, height: 982 }, theme, cookies: canvasPanels({ chatPct: 0 }) })
  await ctx.addInitScript({ content: `try{localStorage.setItem("lx", ${JSON.stringify(process.env.LX ?? "")}); if(!${JSON.stringify(process.env.LX ?? "")}) localStorage.removeItem("lx")}catch(e){}` })
  const page = await ctx.newPage()
  await page.goto("/room-checkout-flow")
  await settle(page, { freeze: false })
  await page.waitForTimeout(1500)
  const box = (await page.locator('.react-transform-wrapper').boundingBox())!
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  if (css) await page.addStyleTag({ content: css })
  const zoomTo = async (target: number) => {
    for (let i = 0; i < 6; i++) {
      const z = (await page.evaluate(READ) as any).zoom
      if (Math.abs(z / target - 1) < 0.002) break
      const dy = -(target / z - 1) / 0.015
      await page.keyboard.down("Control")
      await page.mouse.wheel(0, dy)
      await page.keyboard.up("Control")
      await page.waitForTimeout(60)
    }
    await page.waitForTimeout(700)
  }
  // Fit first so the content sits around the anchor.
  await page.keyboard.press("Shift+1")
  await page.waitForTimeout(800)
  const rows: any[] = []
  if (sweep) {
    const zs: number[] = []
    for (let z = 1; z >= 0.02; z *= 0.95) zs.push(z)
    for (const z of zs) { await zoomTo(z); rows.push(await page.evaluate(READ)) }
    writeFileSync(`${OUT}/sweep.json`, JSON.stringify(rows))
  }
  for (const z of shots) {
    await page.keyboard.press("Shift+1"); await page.waitForTimeout(600)
    const st0: any = await page.evaluate(READ)
    const cd = st0.layers.find((l: any) => l.id === "layer-cart-desktop")
    const ax = cd.x, ay = cd.y - 30
    await page.mouse.move(ax, ay)
    await zoomTo(z)
    await page.mouse.move(5, 5)
    await page.waitForTimeout(400)
    const st: any = await page.evaluate(READ)
    const xs = st.layers.map((l: any) => [l.x, l.x + l.w]).flat(), ys = st.layers.map((l: any) => [l.y, l.y + l.h]).flat()
    const W = 760, H = 480
    let mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2
    const ph = st.layers.find((l: any) => l.id === "layer-checkout-mobile")
    if (Math.max(...xs) - Math.min(...xs) > W - 40 || Math.max(...ys) - Math.min(...ys) > H - 60) {
      mx = ax - 24 + W / 2
      my = ay
    }
    const tag = `z${String(Math.round(z * 1000)).padStart(4, "0")}`
    await page.screenshot({ path: `${OUT}/${tag}.${theme}.png`, clip: { x: Math.max(box.x, mx - W / 2), y: Math.max(box.y, my - H / 2 - 10), width: W, height: H } })
    writeFileSync(`${OUT}/${tag}.json`, JSON.stringify(st))
    await page.mouse.move(cx, cy)
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
