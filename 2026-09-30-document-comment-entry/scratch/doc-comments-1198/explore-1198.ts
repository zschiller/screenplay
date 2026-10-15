#!/usr/bin/env tsx
// EXPLORATION #1198 — scratch capture script, never committed.
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { Page } from "playwright-core"

import { launchBrowser, openThemedContext, settle, type Theme } from "./lib/browser"
import { resolveCaptureProfile } from "./profile"
import { canvasPanels, showTooltip, unfreeze } from "./screens"

const OUT = process.env.EXPLORE_OUT!
const profile = resolveCaptureProfile()
const build = profile.hosted ? "web" : "desktop"
const only = (process.env.EXPLORE_ONLY ?? "").split(",").filter(Boolean)
const themes = (process.env.EXPLORE_THEMES ?? "light,dark").split(",") as Theme[]

const VIEWPORT = { width: 1728, height: 1080 }
const LINE = "Does Apple Pay sit above or below the card form?"
const DOC = "doc-checkout-brief"

async function measure(page: Page, name: string) {
  const data = await page.evaluate(`(() => {
    const out = {}
    const q = (k, sel) => { const el = document.querySelector(sel); if (el) { const r = el.getBoundingClientRect(); out[k] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] } }
    q("toolbar", '#inline-comment-bubble-portal [role="toolbar"]')
    q("margin", '[data-explore-margin]')
    q("doc", '[data-markdown-layer]')
    q("composer", '[data-slot="popover-content"], [data-comment-composer]')
    const btns = [...document.querySelectorAll('#inline-comment-bubble-portal [role="toolbar"] button')].map(b => { const r = b.getBoundingClientRect(); return (b.getAttribute('aria-label')||b.textContent.trim()) + ':' + Math.round(r.width) + 'x' + Math.round(r.height) })
    out.buttons = btns
    return out
  })()`)
  console.log(name, JSON.stringify(data))
}

async function open(page: Page, option: string) {
  await page.addInitScript({ content: `window.__explore = ${JSON.stringify(option)}` })
  await page.goto(`/room-checkout-flow`, { waitUntil: "domcontentloaded", timeout: 120_000 })
  await settle(page, { freeze: false })
  const line = page.getByText(LINE, { exact: false }).first()
  await line.waitFor({ state: "visible", timeout: 30_000 })
  // Zoom the canvas to 100%, then pan the line to a fixed spot.
  await page.getByRole("button", { name: /^Zoom, / }).first().click()
  await page.getByRole("menuitem", { name: /Zoom to 100%/ }).click()
  await page.waitForTimeout(800)
  await page.mouse.click(1150, 900)
  await page.waitForTimeout(300)
  const doc = await page.locator(`[data-markdown-layer]`).filter({ hasText: "Checkout brief" }).first().boundingBox()
  if (doc) {
    await page.mouse.move(760, 600)
    await page.mouse.wheel((doc.x - 240) * 2, (doc.y - 150) * 2)
    await page.waitForTimeout(600)
  }
  for (let i = 0; i < 0; i++) {
    const b = await line.boundingBox()
    if (!b) throw new Error("no line box")
    const dx = b.x - 520
    const dy = b.y - 300
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) break
    await page.mouse.move(700, 500)
    await page.mouse.wheel(dx, dy)
    await page.waitForTimeout(500)
  }
  await page.waitForTimeout(800)
}

async function selectLine(page: Page) {
  const line = page.getByText(LINE, { exact: false }).first()
  const box = await line.boundingBox()
  if (!box) throw new Error("no line box")
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
  await page
    .locator('[data-markdown-layer] [contenteditable="true"]')
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
  await page.evaluate(`(() => {
    const ed = window.__exploreEditors[${JSON.stringify(DOC)}]
    let from = -1
    ed.state.doc.descendants((node, pos) => {
      if (from < 0 && node.isText && node.text.includes(${JSON.stringify(LINE)})) {
        from = pos + node.text.indexOf(${JSON.stringify(LINE)})
      }
    })
    ed.chain().focus().setTextSelection({ from, to: from + ${LINE.length} }).run()
  })()`)
  await page
    .locator('#inline-comment-bubble-portal [role="toolbar"]')
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
  await page.waitForTimeout(300)
}

async function shot(page: Page, name: string, theme: Theme) {
  await page.waitForTimeout(400)
  const file = join(OUT, `${name}.${build}.${theme}.png`)
  await page.screenshot({ path: file })
  await measure(page, `${name}.${build}.${theme}`)
}

type Step = (page: Page, theme: Theme) => Promise<void>

const portalButton = (page: Page, name: string) =>
  page.locator("#inline-comment-bubble-portal").getByRole("button", { name, exact: true })

async function hover(page: Page, name: string) {
  const b = portalButton(page, name)
  await b.waitFor({ state: "visible", timeout: 10_000 })
  await b.hover()
  await showTooltip(page)
}

async function press(page: Page, name: string) {
  const b = portalButton(page, name)
  const box = await b.boundingBox()
  if (!box) throw new Error(`no ${name}`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.up()
}

async function typeComment(page: Page, text: string) {
  const box = page.getByPlaceholder("Add a comment…")
  await box.waitFor({ state: "visible", timeout: 10_000 })
  await box.pressSequentially(text, { timeout: 10_000 })
  await page.mouse.move(5, 900)
}

async function pendingHighlight(page: Page) {
  if (!web) {
    // Desktop keeps no thread, so the draft pin is dropped (see the page's note).
    await page.addStyleTag({ content: "[data-comment-pin]{visibility:hidden!important}" })
  }
  await page.evaluate(`(() => {
    const ed = window.__exploreEditors[${JSON.stringify(DOC)}]
    let from = -1
    ed.state.doc.descendants((node, pos) => {
      if (from < 0 && node.isText && node.text.includes(${JSON.stringify(LINE)})) {
        from = pos + node.text.indexOf(${JSON.stringify(LINE)})
      }
    })
    const a = ed.view.domAtPos(from), b = ed.view.domAtPos(from + ${LINE.length})
    const r = document.createRange()
    r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset)
    CSS.highlights.set("explore", new Highlight(r))
    const st = document.createElement("style")
    st.textContent = "::highlight(explore){background-color: rgba(250, 204, 21, 0.55);}"
    document.head.appendChild(st)
  })()`)
}

const NOTE = "Above. Most of our mobile traffic is on iPhone."
const web = build === "web"

const STEPS: Record<string, Step> = {
  today: async (page, theme) => {
    await open(page, "today")
    await selectLine(page)
    await shot(page, "today-toolbar", theme)
  },
  A: async (page, theme) => {
    await open(page, "A")
    await selectLine(page)
    await hover(page, web ? "Comment" : "Send to agent")
    await shot(page, "A-toolbar", theme)
    await press(page, web ? "Comment" : "Send to agent")
    await typeComment(page, NOTE)
    await pendingHighlight(page)
    await shot(page, "A-composer", theme)
  },
  B: async (page, theme) => {
    await open(page, "B")
    await selectLine(page)
    await hover(page, web ? "Comment" : "Send to agent")
    await shot(page, "B-toolbar", theme)
    await press(page, web ? "Comment" : "Send to agent")
    await typeComment(page, NOTE)
    await pendingHighlight(page)
    await shot(page, "B-composer", theme)
  },
  C: async (page, theme) => {
    if (!web) return
    await open(page, "today")
    await page.keyboard.press("c")
    await page.waitForTimeout(300)
    await page.evaluate(`(() => {
      const ed = window.__exploreEditors[${JSON.stringify(DOC)}]
      let from = -1
      ed.state.doc.descendants((node, pos) => {
        if (from < 0 && node.isText && node.text.includes(${JSON.stringify(LINE)})) {
          from = pos + node.text.indexOf(${JSON.stringify(LINE)})
        }
      })
      ed.commands.setTextSelection({ from, to: from + ${LINE.length} })
      const a = ed.view.domAtPos(from), b = ed.view.domAtPos(from + ${LINE.length})
      const r = document.createRange()
      r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset)
      window.__exploreStart[${JSON.stringify(DOC)}]("comment")
    })()`)
    await typeComment(page, NOTE)
    await pendingHighlight(page)
    await shot(page, "C-composer", theme)
  },
  D: async (page, theme) => {
    await open(page, "D")
    await selectLine(page)
    await hover(page, "Reply in chat")
    await shot(page, "D-toolbar", theme)
    await press(page, "Reply in chat")
    // Mock: the quote lands in the panel's composer as a removable card.
    const composer = page.locator('[data-slot="input-group"]').last()
    await composer.locator('[contenteditable="true"]').click()
    await page.keyboard.type(web ? "Which one does the mobile frame use?" : "Put it above; most mobile traffic is iPhone.")
    await page.evaluate(`(() => {
      const groups = document.querySelectorAll('[data-slot="input-group"]')
      const g = groups[groups.length - 1]
      const q = document.createElement("div")
      q.setAttribute("data-explore-quote", "")
      q.style.cssText = "order:-1;width:100%;padding:8px 8px 0 8px;"
      q.innerHTML = '<div class="flex items-start gap-2 rounded-sm border-l-2 border-border bg-muted px-2 py-1.5 text-xs leading-snug text-muted-foreground"><div class="min-w-0 flex-1"><div class="mb-0.5 font-medium text-foreground">Checkout brief · Line 3</div><div class="line-clamp-3">${LINE}</div></div><span class="mt-0.5 shrink-0 text-muted-foreground" aria-label="Remove quote"><svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg></span></div>'
      g.style.flexWrap = "wrap"
      g.prepend(q)
    })()`)
    await page.mouse.move(5, 900)
    await shot(page, "D-chat", theme)
  },
  thread: async (page, theme) => {
    if (!web) return
    await open(page, "A")
    await selectLine(page)
    await press(page, "Comment")
    await typeComment(page, NOTE)
    await page.keyboard.press("Control+Enter")
    await page.waitForTimeout(1500)
    await page.mouse.click(1000, 1150)
    await page.keyboard.press("Escape")
    await page.waitForTimeout(800)
    await shot(page, "today-thread", theme)
    // Open it from its highlight.
    const hl = page.locator("[data-comment-thread]").first()
    if (await hl.count()) {
      await hl.click()
      await page.waitForTimeout(800)
      await shot(page, "today-thread-open", theme)
    }
    // Clean up so later runs start from zero threads.
    await page.getByRole("button", { name: "Thread actions" }).first().click()
    await page.getByRole("menuitem", { name: "Delete thread" }).click()
    const confirm = page.getByRole("button", { name: "Delete", exact: true })
    if (await confirm.count()) await confirm.first().click()
    await page.waitForTimeout(1000)
  },
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await launchBrowser()
  try {
    for (const [name, step] of Object.entries(STEPS)) {
      if (only.length && !only.includes(name)) continue
      for (const theme of themes) {
        const context = await openThemedContext(browser, profile, { viewport: VIEWPORT, theme, cookies: canvasPanels({ sidebarPct: 12, chatPct: 24 }) })
        const page = await context.newPage()
        try {
          await step(page, theme)
        } catch (err) {
          console.warn(`! ${name} ${theme}:`, err instanceof Error ? err.message.split("\n")[0] : err)
          await page.screenshot({ path: join(OUT, `ERR-${name}.${build}.${theme}.png`) }).catch(() => {})
        } finally {
          await context.close()
        }
      }
    }
  } finally {
    await browser.close()
  }
}
void unfreeze
void showTooltip
main()
