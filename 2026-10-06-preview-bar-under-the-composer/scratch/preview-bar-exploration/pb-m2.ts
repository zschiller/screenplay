import { launchBrowser, openThemedContext, settle } from "../../lib/browser"
import { resolveCaptureProfile } from "../../profile"
import { canvasPanels, ids, selectWorkspace } from "../helpers"
async function main() {
  const browser = await launchBrowser()
  const ctx = await openThemedContext(browser, resolveCaptureProfile(), { viewport: { width: 1512, height: 982 }, theme: "light", cookies: canvasPanels({ chatPct: 30 }) })
  const page = await ctx.newPage()
  await page.goto(`/${ids.rooms.checkout}`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await settle(page, { freeze: false })
  await selectWorkspace(page, "Checkout polish")
  await page.waitForTimeout(2000)
  console.log(await page.evaluate(`(() => {
    const c = [...document.querySelectorAll('[data-slot=composer]')].filter(e => e.offsetParent).pop()
    const out = {}
    out.composerPad = getComputedStyle(c).padding
    c.querySelectorAll('button').forEach((b,i) => { const r = b.getBoundingClientRect(); out['b'+i] = (b.getAttribute('aria-label')||b.textContent).slice(0,20)+' '+r.x.toFixed(1)+'..'+r.right.toFixed(1)+' y'+r.y.toFixed(1)+'..'+r.bottom.toFixed(1) })
    const p = c.querySelector('.tiptap p'); const range = document.createRange(); 
    out.tiptap = c.querySelector('.tiptap') && getComputedStyle(c.querySelector('.tiptap')).padding
    const ph = p && getComputedStyle(p, '::before'); out.ph = ph && ph.content
    out.pRect = p && JSON.stringify(p.getBoundingClientRect())
    const pane = document.querySelector('[data-pane]'); const tab = pane.querySelector('[role=tab]'); out.tabPad = getComputedStyle(tab).padding
    return JSON.stringify(out, null, 1)
  })()`))
  await browser.close()
}
main()
