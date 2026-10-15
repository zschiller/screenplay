// Scratch: chat panel spacing exploration. Not committed.
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { resolveCaptureProfile } from "../../profile"
import { launchBrowser, openThemedContext, settle } from "../../lib/browser"
import { CORE_SCREENS as coreScreens } from "../core"

const OUT = process.env.OUT!
const opts = (process.env.OPTS ?? "today").split(",")
const names = (process.env.SCREENS ?? "canvas-agent-chat").split(",")
const themes = (process.env.THEMES ?? "light,dark").split(",") as ("light" | "dark")[]
const CSS_DIR = process.env.CSS_DIR!
const MEASURE = process.env.MEASURE === "1"

const measureJs = `(() => {
  const panel = document.querySelector('[data-slot=composer]')?.closest('[data-panel]') 
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return {x:Math.round(b.x), y:Math.round(b.y), w:Math.round(b.width), h:Math.round(b.height)} }
  const pb = panel?.getBoundingClientRect()
  const rel = (el) => { const b = r(el); if (!b || !pb) return b; return {...b, left: Math.round(b.x - pb.x), right: Math.round(pb.right - (b.x + b.w))} }
  const out = { panel: r(panel) }
  const q = (k, s) => { const els = [...(panel ?? document).querySelectorAll(s)].filter(e => e.offsetParent); out[k] = els.slice(0,3).map(e => ({...rel(e), fs: getComputedStyle(e).fontSize, pad: getComputedStyle(e).padding, cls: (e.className+'').slice(0,90)})) }
  q('header', '.h-12')
  q('scrollContent', '.overflow-y-auto > .flex.min-h-full')
  q('userBubble', '.rounded-xl.bg-muted')
  q('summaryRow', '.group\\\\/summary')
  q('prose', '[data-slot=chat-markdown], .prose')
  q('composer', '[data-slot=composer]')
  q('inputGroup', '[data-slot=composer] [data-slot=input-group]')
  q('editor', '[data-slot=composer] .tiptap')
  q('footer', '[data-slot=composer] ~ *')
  return out
})()`

const profile = resolveCaptureProfile()
const browser = await launchBrowser()
for (const name of names) {
  const screen = coreScreens.find((s) => s.name === name)!
  for (const opt of opts) {
    const css = opt === "today" ? "" : await readFile(join(CSS_DIR, `${opt}.css`), "utf8")
    for (const theme of themes) {
      const ctx = await openThemedContext(browser, profile, { viewport: { width: 1512, height: 982 }, theme, cookies: screen.cookies })
      const page = await ctx.newPage()
      await screen.beforeNavigate?.(page)
      await page.goto(screen.path, { waitUntil: "domcontentloaded", timeout: 120_000 })
      await settle(page, { freeze: false })
      try { await screen.prepare?.(page) } catch (e) { console.warn("prepare failed", name, e) }
      if (css) await page.addStyleTag({ content: css })
      await settle(page, { freeze: true })
      await page.waitForTimeout(screen.settleMs ?? 300)
      await page.mouse.move(10, 900)
      const panel = page.locator("[data-testid=chat]").first()
      await mkdir(OUT, { recursive: true })
      const file = join(OUT, `${name}.${opt}.${theme}.png`)
      await panel.screenshot({ path: file })
      if (MEASURE && theme === "light") {
        const m = await page.evaluate(measureJs)
        await writeFile(join(OUT, `${name}.${opt}.measure.json`), JSON.stringify(m, null, 1))
      }
      console.log("→", file)
      await ctx.close()
    }
  }
}
await browser.close()
