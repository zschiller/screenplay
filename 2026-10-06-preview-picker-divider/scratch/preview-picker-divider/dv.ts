import type { Page } from "playwright-core"
import { appendFileSync, mkdirSync } from "node:fs"
import { ids } from "../helpers"
import type { Screen } from "../screen"

const OUT = "/tmp/claude-0/-home-user-screenplay/579c0fc9-9d74-5e73-9ffd-3e07c930d070/scratchpad/shots"
mkdirSync(OUT, { recursive: true })
const DRAW = { x1: 900, y1: 160, x2: 1240, y2: 700 }
async function draw(page: Page) {
  await page.mouse.click(5, 500)
  await page.keyboard.press("Escape")
  await page.mouse.move(900, 500)
  await page.mouse.wheel(760, 0)
  await page.waitForTimeout(500)
  await page.keyboard.press("f")
  await page.mouse.move(DRAW.x1, DRAW.y1)
  await page.mouse.down()
  await page.mouse.move(DRAW.x2 - 50, DRAW.y2 - 50, { steps: 8 })
  await page.mouse.move(DRAW.x2, DRAW.y2, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(800)
}

const NAMES = ["Pricing table refresh", "Order receipt email", "Onboarding checklist", "Saved cards", "Promo code field", "Account settings", "Search results empty state", "Shipping estimate", "Gift wrap option", "Mobile nav", "Wishlist", "Dark mode tokens", "Returns flow"]

// Every option is Today with its own stylesheet; B, C and D also move DOM.
const CSS: Record<string, string> = {
  today: "",
  a: `
  [data-dv] [data-slot=command]{padding:0!important}
  [data-dv] [data-slot=command-input-wrapper]{padding:8px 8px 0!important}
  [data-dv] [data-slot=command-group]{padding:4px 8px!important}
  [data-dv] [data-slot=command-list]{padding-bottom:4px}
  [data-dv] [data-slot=command-separator]{margin:4px 0!important}`,
  b: `
  [data-dv] [data-slot=command]{padding:0!important}
  [data-dv] [data-slot=command-input-wrapper]{padding:8px 8px 0!important}
  [data-dv] [data-slot=command-group]{padding:4px 8px!important}
  [data-dv] [data-slot=command-list]{padding-bottom:4px}
  [data-dv] [data-dv-footer]{padding:4px 8px 8px!important}
  [data-dv] [data-slot=command-separator]{margin:0!important}`,
  d: `
  [data-dv] [data-slot=command-input-wrapper]{display:flex;gap:4px;align-items:center}
  [data-dv] [data-slot=command-separator],[data-dv] [data-dv-newchat]{display:none}
  [data-dv] [data-dv-btn]{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;color:var(--foreground);background:transparent}
  [data-dv] [data-dv-btn] svg{width:16px;height:16px}`,
}
CSS.c = CSS.b + `
  [data-dv] [data-slot=command-separator]{background:transparent!important}
  [data-dv][data-dv-below] [data-slot=command-separator]{background:var(--border)!important}
  [data-dv] [data-slot=command-input-wrapper]{padding-bottom:4px!important;border-bottom:1px solid transparent}
  [data-dv][data-dv-above] [data-slot=command-input-wrapper]{border-bottom-color:var(--border)}
  [data-dv] [data-slot=command-list] > div > [data-slot=command-group]:first-child{padding-top:0!important}
  [data-dv][data-dv-above] [data-slot=command-list] > div > [data-slot=command-group]:first-child{padding-top:4px!important}`

// Round 2: C's behaviour (pinned footer, lines only while scrolled), two spacing systems.
// Scrolling only recolours the lines; no padding changes, so nothing moves.
const PINNED = `
  [data-dv] [data-slot=command]{padding:0!important}
  [data-dv] [data-slot=command-group]{padding:0!important}
  [data-dv] [data-slot=command-separator]{margin:0!important;background:transparent!important}
  [data-dv][data-dv-below] [data-slot=command-separator]{background:var(--border)!important}
  [data-dv] [data-slot=command-input-wrapper]{border-bottom:1px solid transparent}
  [data-dv][data-dv-above] [data-slot=command-input-wrapper]{border-bottom-color:var(--border)}`
CSS.r2a = PINNED + `
  [data-dv] [data-slot=command-input-wrapper]{padding:8px!important}
  [data-dv] [data-slot=command-list]{padding:0 8px 4px}
  [data-dv] [data-dv-footer]{padding:4px 8px 8px!important}`
CSS.r2b = PINNED + `
  [data-dv] [data-slot=command-input-wrapper]{padding:4px!important}
  [data-dv] [data-slot=command-list]{padding:0 4px 2px}
  [data-dv] [data-dv-footer]{padding:2px 4px 4px!important}`

async function apply(page: Page, opt: string) {
  await page.evaluate((opt) => {
    const card = document.querySelector("[role=dialog][data-slot=floating-toolbar]") as HTMLElement
    card.setAttribute("data-dv", "")
    const sep = card.querySelector("[data-slot=command-separator]")!
    const nc = card.querySelector("[data-value=new-chat]")!.closest("[data-slot=command-group]") as HTMLElement
    if (opt === "b" || opt === "c" || opt.startsWith("r2")) {
      nc.setAttribute("data-dv-footer", "")
      const cmd = card.querySelector("[data-slot=command]")!
      cmd.append(sep, nc)
    }
    if (opt === "d") {
      nc.setAttribute("data-dv-newchat", "")
      const plus = nc.querySelector("svg")!.cloneNode(true) as SVGElement
      plus.removeAttribute("class")
      const btn = document.createElement("button")
      btn.setAttribute("data-dv-btn", "")
      btn.setAttribute("aria-label", "New chat")
      btn.append(plus)
      card.querySelector("[data-slot=command-input-wrapper]")!.append(btn)
    }
  }, opt)
  if (CSS[opt]) await page.addStyleTag({ content: CSS[opt] })
}

async function sync(page: Page) {
  await page.evaluate(() => {
    const card = document.querySelector("[data-dv]") as HTMLElement
    const list = card.querySelector("[data-slot=command-list]") as HTMLElement
    card.toggleAttribute("data-dv-above", list.scrollTop > 0)
    card.toggleAttribute("data-dv-below", list.scrollTop + list.clientHeight < list.scrollHeight - 1)
  })
}

async function shot(page: Page, opt: string, state: string) {
  await sync(page)
  await page.waitForTimeout(150)
  const theme = await page.evaluate(() => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"))
  const box = (await page.locator("[data-dv]").boundingBox())!
  const m = 24
  await page.screenshot({
    path: `${OUT}/${opt}-${state}.${theme}.png`,
    clip: { x: box.x - m, y: box.y - m, width: 352 + 2 * m, height: 470 },
  })
  const measure = await page.evaluate(`(() => {
    function r(s) { var e = document.querySelector(s); if (!e) return null; var b = e.getBoundingClientRect(); return [Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10, Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10] }
    return { card: r("[data-dv]"), sep: r("[data-dv] [data-slot=command-separator]"), list: r("[data-dv] [data-slot=command-list]"), input: r("[data-dv] [data-slot=input-group]"), item: r("[data-dv] [data-slot=command-item]"), newchat: r("[data-dv] [data-value=new-chat]") }
  })()`) as object
  appendFileSync(`${OUT}/measure.jsonl`, JSON.stringify({ opt, state, theme, ...measure }) + "\n")
}

async function lengthen(page: Page) {
  await page.evaluate((names) => {
    const card = document.querySelector("[data-dv]")!
    const items = card.querySelectorAll("[data-slot=command-list] [data-slot=command-item]:not([data-value=new-chat])")
    const src = Array.from(items).find((i) => i.querySelector("[aria-label=Ready]")) ?? items[items.length - 1]
    const end = src.closest("[cmdk-group-items]")!
    for (const n of names) {
      const c = src.cloneNode(true) as HTMLElement
      c.querySelector("[data-slot=workspace-mention-end]")?.remove()
      c.setAttribute("data-selected", "false")
      c.setAttribute("aria-selected", "false")
      const label = c.querySelector("[data-slot=workspace-mention] > span:last-child > span")!
      label.textContent = n
      end.append(c)
    }
  }, NAMES)
}

async function run(page: Page, opt: string) {
  await draw(page)
  const sel = "[role=dialog][data-slot=floating-toolbar] [data-value=new-chat]"
  if (!(await page.locator(sel).count())) await draw(page)
  await page.waitForSelector(sel, { timeout: 5000 })
  await apply(page, opt)
  await page.mouse.move(10, 10)
  await shot(page, opt, "short")
  await lengthen(page)
  const list = page.locator("[data-dv] [data-slot=command-list]")
  await list.evaluate((e) => (e.scrollTop = 0))
  await shot(page, opt, "long-top")
  await list.evaluate((e) => (e.scrollTop = (e.scrollHeight - e.clientHeight) / 2))
  await shot(page, opt, "long-mid")
  await list.evaluate((e) => (e.scrollTop = e.scrollHeight))
  await shot(page, opt, "long-end")
}

const screens: Screen[] = ["today", "a", "b", "c", "d", "r2a", "r2b"].map((opt) => ({
  name: `dv-${opt}`,
  description: `divider option ${opt}`,
  path: `/${ids.rooms.checkout}`,
  prepare: (page) => run(page, opt),
}))
export default screens
