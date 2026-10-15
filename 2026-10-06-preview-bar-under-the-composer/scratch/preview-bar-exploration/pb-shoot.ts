import { writeFileSync } from "node:fs"
import { launchBrowser, openThemedContext, settle } from "../../lib/browser"
import { resolveCaptureProfile } from "../../profile"
import { canvasPanels, ids, selectWorkspace } from "../helpers"
import { peer, measure } from "./pb-lib"

const OUT = process.env.OUT!
const ONLY = process.env.ONLY?.split(",")
const STOP_CIRCLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="16" height="16" fill="currentColor"><path d="M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26Zm0,192a90,90,0,1,1,90-90A90.1,90.1,0,0,1,128,218ZM160,90H96a6,6,0,0,0-6,6v64a6,6,0,0,0,6,6h64a6,6,0,0,0,6-6V96A6,6,0,0,0,160,90Zm-6,64H102V102h52Z"/></svg>`

// Tags the footnote's parts so option CSS can target them.
const TAG = `(() => {
  const pane = [...document.querySelectorAll('[data-pane]')].find(e => e.offsetParent); if (!pane) return
  const bar = pane.firstElementChild; bar.dataset.pbBar = ''
  bar.querySelector('div.w-max').dataset.pbNames = ''
  bar.lastElementChild.dataset.pbRight = ''
  pane.querySelectorAll('[role=tab]').forEach(t => t.dataset.pbTab = '')
  const stop = [...pane.querySelectorAll('button')].find(b => /Stop|Run/.test(b.textContent || '')); if (stop) stop.dataset.pbStop = ''
  const c = [...document.querySelectorAll('[data-slot=composer]')].filter(e => e.offsetParent).pop(); if (c) c.dataset.pbComposer = ''
})()`

const SPACING_A = `
[data-pane=closed] [data-pb-names]{padding-left:13px!important}
[data-pane=closed] [data-pb-right]{padding-right:19px!important}
[data-pane=closed] [data-pb-bar]{transform:translateY(4px)}`
const SPACING_B = `
[data-pb-composer]{padding-bottom:8px!important}
[data-pane=closed] [data-pb-bar]{height:36px!important;border-top:1px solid var(--border)!important;align-items:center!important}
[data-pane=closed] [data-pb-bar]>*{height:28px!important;align-self:center!important}
[data-pane=closed] [data-pb-names]{padding-left:8px!important;height:28px!important}
[data-pane=closed] [data-pb-right]{padding-right:6px!important;align-self:center!important}`
const ICON_C = `(() => { const b = document.querySelector('[data-pb-stop]'); if (!b || b.dataset.pbSwapped) return; const svg = b.querySelector('svg'); if (/Stop/.test(b.textContent)) { svg.outerHTML = ${JSON.stringify(STOP_CIRCLE)}; b.dataset.pbSwapped = '1' } })()`

// Booting: the transcript as today's booting chat shows it, over a composer.
const CENTRE = (inner: string) => `(() => {
  window.__pbInner = ${JSON.stringify(inner)}
  const c = document.querySelector('[data-pb-composer]'); if (!c) return
  const chat = c.parentElement
  const starter = [...chat.querySelectorAll('h1,h2,h3,div')].find(e => /^Change what/.test(e.textContent || '') && e.querySelector('button'))
  const host = starter && starter.closest('[data-slot=empty]') || starter
  if (!host || host.dataset.pbDone) return
  host.dataset.pbDone = '1'
  host.style.visibility = 'hidden'
  const line = document.createElement('div')
  line.className = 'pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground'
  line.innerHTML = window.__pbInner.split('SPIN').join(window.__pbSpinner)
  const box = host.parentElement; box.style.position = 'relative'; box.appendChild(line)
})()`
const SPINNER_LINE = CENTRE('<span class="flex items-center gap-2">SPIN Still setting up the code…</span>')
const DISABLE = `(() => {
  const c = document.querySelector('[data-pb-composer]'); if (!c) return
  c.querySelectorAll('button').forEach(b => { b.disabled = true })
  const ed = c.querySelector('.tiptap'); if (ed) { ed.setAttribute('contenteditable', 'false'); ed.closest('[data-slot=input-group]')?.setAttribute('data-disabled', 'true') }
  c.querySelector('[data-slot=input-group]').classList.add('pb-dis')
})()`
const DISABLE_CSS = `.pb-dis{background:transparent!important}.pb-dis .tiptap{opacity:.5}`
const DISABLE_STARTERS = `(() => { const c = document.querySelector('[data-pb-composer]'); const chat = c.parentElement; chat.querySelectorAll('button').forEach(b => { if (/Explain how|Tighten the|Add a loading/.test(b.textContent)) b.disabled = true }) })()`
const BAR_PROGRESS = `(() => {
  const tab = document.querySelector('[data-pb-tab]'); if (!tab || tab.dataset.pbP) return; tab.dataset.pbP = '1'
  const span = tab.querySelector('span'); span.innerHTML = window.__pbSpinner.replace('size-4', 'size-3') + ' Cloning repository… <span class="tabular-nums">12s</span>'
  span.className = 'flex items-center gap-1.5'
  tab.parentElement.parentElement.querySelectorAll('[data-pb-tab]').forEach((t, i) => { if (i) t.parentElement.style.display = 'none' })
})()`
const HIDE_BAR = `[data-pane=closed]{visibility:hidden}`
const TYPE_B = `(() => { const c = document.querySelector('[data-pb-composer]'); const p = c.querySelector('.tiptap p'); p.textContent = 'Add an empty state to the cart drawer'; p.classList.remove('is-empty', 'is-editor-empty'); p.removeAttribute('data-placeholder') })()`

const ICONS = {"sqfill": "M224,48V208a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32H208A16,16,0,0,1,224,48Z", "playfill": "M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z", "stopcircle": "M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26Zm0,192a90,90,0,1,1,90-90A90.1,90.1,0,0,1,128,218ZM160,90H96a6,6,0,0,0-6,6v64a6,6,0,0,0,6,6h64a6,6,0,0,0,6-6V96A6,6,0,0,0,160,90Zm-6,64H102V102h52Z", "playcircle": "M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26Zm0,192a90,90,0,1,1,90-90A90.1,90.1,0,0,1,128,218Zm47.18-95.09-64-40A6,6,0,0,0,102,88v80a6,6,0,0,0,9.18,5.09l64-40a6,6,0,0,0,0-10.18ZM114,157.17V98.83L160.68,128Z"}

const svgOf = (d: string, size = 16) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}" fill="currentColor"><path d="${d}"/></svg>`
const CTL = (stop: string | null, play: string | null, iconOnly = false) => `(() => { const b = document.querySelector('[data-pb-stop]'); if (!b || b.dataset.pbCtl) return; b.dataset.pbCtl = '1'
  const isStop = /Stop/.test(b.textContent); const svg = b.querySelector('svg'); const d = isStop ? ${JSON.stringify(stop)} : ${JSON.stringify(play)}
  if (d === null) svg.remove(); else svg.outerHTML = ${JSON.stringify(svgOf("__D__"))}.replace('__D__', d)
  if (${iconOnly}) { [...b.childNodes].forEach(n => { if (n.nodeType === 3) n.remove() }); b.style.width = '28px'; b.style.padding = '0'; b.style.justifyContent = 'center'; b.setAttribute('aria-label', isStop ? 'Stop preview' : 'Run preview') } })()`

const ic = (d: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" class="size-4 shrink-0"><path d="${d}"/></svg>`
const MSG_A = CENTRE('<span class="flex items-center gap-2">SPIN <span>Cloning repository · <span class="tabular-nums">12s</span></span></span>')
const MSG_B = CENTRE('<div class="flex flex-col items-center gap-1"><span class="flex items-center gap-2 text-foreground">SPIN Setting up the code</span><span>Cloning repository · <span class="tabular-nums">12s</span></span></div>')
const MSG_C = CENTRE(`<div class="flex flex-col gap-3 text-left"><div class="flex flex-col gap-2"><span class="flex items-center gap-2 text-foreground">${ic("M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z")} Branch created</span><span class="flex items-center gap-2 text-foreground">SPIN Cloning repository <span class="text-muted-foreground tabular-nums">12s</span></span><span class="flex items-center gap-2">${ic("M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Z")} Configuring git</span></div><span class="text-balance" style="max-width:260px">The agent starts once the code is ready. Install and preview finish in the background.</span></div>`)

const stepRow = (state: "done" | "now" | "todo", text: string, time = "") =>
  state === "done" ? `<span class="flex items-center gap-2 text-foreground">${ic("M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z")} ${text}</span>`
  : state === "now" ? `<span class="flex items-center gap-2 text-foreground">SPIN ${text}${time ? ` <span class="text-muted-foreground tabular-nums">${time}</span>` : ""}</span>`
  : `<span class="flex items-center gap-2">${ic("M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Z")} ${text}</span>`
const STEPS = (rows: string[]) => CENTRE(`<div class="flex flex-col gap-3 text-left"><div class="flex flex-col gap-2">${rows.join("")}</div><span class="text-balance" style="max-width:260px">The agent starts once the code is ready. Install and preview finish in the background.</span></div>`)
const STEPS_CLONE = STEPS([stepRow("done", "Branch created"), stepRow("now", "Cloning repository", "12s"), stepRow("todo", "Configuring git")])
const STEPS_GIT = STEPS([stepRow("done", "Branch created"), stepRow("done", "Repository cloned"), stepRow("now", "Configuring git", "2s")])
const STEPS_RESTART = STEPS([stepRow("now", "Restoring the code", "6s")])
const INSET_A = `[data-pane=closed] [data-pb-names]{padding-left:7px!important}[data-pane=closed] [data-pb-right]{padding-right:6px!important}`
const INSET_B = `[data-pane=closed] [data-pb-names]{padding-left:0!important;margin-left:-1px}[data-pane=closed] [data-pb-right]{padding-right:8px!important}[data-pane=closed] [data-pb-stop]{padding-right:0!important}`
const TOP_B = `[data-pane=closed] [data-pb-bar]{transform:translateY(1.5px)}`

const BTN = "inline-flex items-center justify-center rounded-lg border h-7 gap-1 pl-1.5 pr-2.5 text-sm font-medium text-foreground"
const STEPS_FAIL = CENTRE(`<div class="flex flex-col gap-3 text-left"><div class="flex flex-col gap-2">${stepRow("done", "Branch created")}<span class="flex items-center gap-2 text-destructive">${ic("M235.07,189.09,147.61,37.22h0a22.75,22.75,0,0,0-39.22,0L20.93,189.09a21.53,21.53,0,0,0,0,21.72A22.35,22.35,0,0,0,40.55,222h174.9a22.35,22.35,0,0,0,19.6-11.19A21.53,21.53,0,0,0,235.07,189.09ZM224.66,204.8a10.46,10.46,0,0,1-9.21,5.2H40.55a10.46,10.46,0,0,1-9.21-5.2,9.51,9.51,0,0,1,0-9.72L118.79,43.21a10.75,10.75,0,0,1,18.42,0l87.46,151.87A9.51,9.51,0,0,1,224.66,204.8ZM122,144V104a6,6,0,0,1,12,0v40a6,6,0,0,1-12,0Zm16,36a10,10,0,1,1-10-10A10,10,0,0,1,138,180Z")} Cloning repository failed</span>${stepRow("todo", "Configuring git")}</div><span class="text-balance" style="max-width:260px">Couldn’t clone acme/storefront: repository not found or no access.</span><div class="flex gap-2"><span class="${BTN} border-border bg-background dark:border-input dark:bg-input/30">${ic("M238,56v48a6,6,0,0,1-6,6H184a6,6,0,0,1,0-12h32.55l-30.38-27.8c-.06-.06-.12-.13-.19-.19a82,82,0,1,0-1.7,117.65,6,6,0,0,1,8.24,8.73A93.46,93.46,0,0,1,128,222h-1.28A94,94,0,1,1,194.37,61.4L226,90.35V56a6,6,0,1,1,12,0Z")} Retry</span><span class="${BTN} border-transparent">${ic("M98,136a6,6,0,0,1,6-6h64a6,6,0,0,1,0,12H104A6,6,0,0,1,98,136Zm6-26h64a6,6,0,0,0,0-12H104a6,6,0,0,0,0,12Zm126,82a30,30,0,0,1-30,30H88a30,30,0,0,1-30-30V64a18,18,0,0,0-36,0c0,6.76,5.58,11.19,5.640,11.23A6,6,0,1,1,20.4,84.8C20,84.48,10,76.85,10,64A30,30,0,0,1,40,34H176a30,30,0,0,1,30,30V170h10a6,6,0,0,1,3.6,1.2C220,171.52,230,179.15,230,192Zm-124,0c0-6.76-5.59-11.19-5.64-11.23A6,6,0,0,1,104,170h90V64a18,18,0,0,0-18-18H64a29.820,29.820,0,0,1,6,18V192a18,18,0,0,0,36,0Zm112,0a14.94,14.94,0,0,0-4.34-10H115.88A24.83,24.83,0,0,1,118,192a29.87,29.87,0,0,1-6,18h88A18,18,0,0,0,218,192Z")} Open logs</span></div></div>`)

type Shot = { name: string; state: "running" | "booting" | "codeready" | "error" | "stopped" | "srvstopped"; css?: string; js?: string[]; hoverSend?: string }
const SHOTS: Shot[] = [
  { name: "today-running", state: "running" },
  { name: "today-booting", state: "booting" },
  { name: "today-codeready", state: "codeready" },
  { name: "today-error", state: "error" },
  { name: "today-stopped", state: "stopped" },
  { name: "sp-a", state: "running", css: SPACING_A },
  { name: "sp-b", state: "running", css: SPACING_B },
  { name: "sp-c", state: "running", css: SPACING_A, js: [ICON_C] },
  { name: "su-a", state: "codeready", css: SPACING_A + DISABLE_CSS, js: [ICON_C, SPINNER_LINE, DISABLE] },
  { name: "su-b", state: "codeready", css: SPACING_A, js: [ICON_C, SPINNER_LINE, TYPE_B], hoverSend: "Sends once the code is ready" },
  { name: "su-c", state: "codeready", css: SPACING_A + DISABLE_CSS, js: [ICON_C, DISABLE, DISABLE_STARTERS, BAR_PROGRESS] },
  { name: "su-d", state: "booting", css: HIDE_BAR },
  { name: "su-a-ready", state: "codeready", css: SPACING_A, js: [ICON_C] },
  ...(["running", "srvstopped"] as const).flatMap((st) => [
    { name: `ctl-today-${st}`, state: st, css: SPACING_A },
    { name: `ctl-a-${st}`, state: st, css: SPACING_A, js: [CTL(ICONS.sqfill, ICONS.playfill)] },
    { name: `ctl-b-${st}`, state: st, css: SPACING_A, js: [CTL(ICONS.stopcircle, ICONS.playcircle)] },
    { name: `ctl-c-${st}`, state: st, css: SPACING_A, js: [CTL(ICONS.sqfill, ICONS.playfill, true)] },
    { name: `ctl-d-${st}`, state: st, css: SPACING_A, js: [CTL(null, null)] },
  ] as Shot[]),
  ...(["running", "codeready"] as const).flatMap((st) => {
    const filled = CTL(ICONS.sqfill, ICONS.playfill)
    const setup = st === "codeready" ? [SPINNER_LINE, DISABLE] : []
    const css = (ty: string) => SPACING_A.replace("translateY(4px)", `translateY(${ty})`) + DISABLE_CSS
    const pane = (px: number) => `(() => { const p = document.querySelector('[data-pane]').closest('[data-panel]'); p.style.flex = '0 0 ${px}px' })()`
    const tag = st === "running" ? "running" : "setup"
    return [
      { name: `r2-a-${tag}`, state: st, css: css("4px"), js: [filled, ...setup] },
      { name: `r2-a1-${tag}`, state: st, css: css("1.5px"), js: [filled, ...setup] },
      { name: `r2-a2-${tag}`, state: st, css: css("1.5px"), js: [filled, ...setup, pane(31)] },
    ] as Shot[]
  }),
  ...([["ma", MSG_A], ["mb", MSG_B], ["mc", MSG_C]] as const).map(([n, m]) => ({ name: `r2-${n}`, state: "codeready", css: SPACING_A.replace("translateY(4px)", "translateY(1.5px)") + DISABLE_CSS, js: [CTL(ICONS.sqfill, ICONS.playfill), m, DISABLE, `(() => { const p = document.querySelector('[data-pane]').closest('[data-panel]'); p.style.flex = '0 0 31px' })()`] }) as Shot),
  ...(() => {
    const filled = CTL(ICONS.sqfill, ICONS.playfill)
    const out: Shot[] = []
    for (const [n, inset] of [["r1", SPACING_A], ["a", INSET_A], ["b", INSET_B]] as const) {
      const css = SPACING_A + inset + TOP_B + DISABLE_CSS
      out.push({ name: `r3-${n}-running`, state: "running", css, js: [filled] })
      out.push({ name: `r3-${n}-setup`, state: "codeready", css, js: [filled, STEPS_CLONE, DISABLE] })
    }
    const css = SPACING_A + INSET_A + TOP_B + DISABLE_CSS
    out.push({ name: "r3-git", state: "codeready", css, js: [filled, STEPS_GIT, DISABLE] })
    out.push({ name: "r3-fail", state: "codeready", css, js: [filled, STEPS_FAIL, DISABLE, `(() => { const d = document.querySelector("[data-dev-server-state]"); if (d) { d.className = d.className.replace(/bg-[^ ]+/g, ""); d.classList.add("bg-destructive-fill") } })()`] })
    out.push({ name: "r3-restart", state: "codeready", css, js: [filled, STEPS_RESTART, DISABLE] })
    return out
  })(),
]

async function main() {
  const profile = resolveCaptureProfile()
  const browser = await launchBrowser()
  const p = await peer(ids.rooms.checkout)
  const id = ids.branches.checkoutPolish
  const orig = p.get(id)!
  const base = { devServerStoppedAt: orig.devServerStoppedAt, status: orig.status, statusMessage: orig.statusMessage, codeReady: orig.codeReady, error: orig.error }
  const states: Record<Shot["state"], Partial<typeof orig>> = {
    running: {},
    booting: { status: "creating", statusMessage: "Cloning repository…", codeReady: false },
    codeready: { status: "creating", statusMessage: "Installing dependencies…", codeReady: true },
    error: { status: "error", statusMessage: "Installing dependencies…", error: "setup script exited with code 1" },
    stopped: { status: "stopped" },
    srvstopped: { devServerStoppedAt: Date.now() - 240000 },
  }
  const measures: Record<string, unknown> = {}
  try {
    for (const theme of (process.env.THEMES ?? "light,dark").split(",") as ("light" | "dark")[]) {
      for (const shot of SHOTS) {
        if (ONLY && !ONLY.includes(shot.name)) continue
        p.patch(id, { ...base, ...states[shot.state] })
        const ctx = await openThemedContext(browser, profile, { viewport: { width: 1512, height: 982 }, theme, cookies: canvasPanels({ chatPct: 30 }) })
        const page = await ctx.newPage()
        await page.goto(`/${ids.rooms.checkout}`, { waitUntil: "domcontentloaded", timeout: 120000 })
        await settle(page, { freeze: false })
        await selectWorkspace(page, "Checkout polish")
        await page.waitForTimeout(2500)
        // A Spinner's markup, borrowed from the chat's own loading line.
        await page.evaluate(`window.__pbSpinner = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" class="size-4 shrink-0"><path d="M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z"/></svg>'`)
        if (shot.js || shot.css) {
          // A spinner to borrow: the booting chat has one; else make one from a loader icon.
          await page.evaluate(TAG)
          if (shot.css) await page.addStyleTag({ content: shot.css })
          for (const js of shot.js ?? []) await page.evaluate(js)
        }
        await page.mouse.move(0, 0)
        if (shot.hoverSend) {
          await page.locator('[data-pb-composer] button[aria-label="Send"], [data-pb-composer] button:has-text("Send")').last().hover().catch(() => {})
          await page.waitForTimeout(900)
          await page.evaluate(`(() => { const t = document.querySelector('[data-slot=tooltip-content]'); if (t) { const n = [...t.childNodes].find(n => n.nodeType === 3 || n.nodeName === 'SPAN'); if (n) n.textContent = ${JSON.stringify(shot.hoverSend)} } })()`)
        }
        await settle(page, { extraMs: 300 })
        measures[`${shot.name}.${theme}`] = await measure(page)
        await page.screenshot({ path: `${OUT}/${shot.name}.${theme}.png`, clip: { x: 1059, y: 0, width: 453, height: 982 } })
        await ctx.close()
      }
    }
  } finally {
    p.patch(id, base)
    await new Promise((r) => setTimeout(r, 500))
    p.close()
    await browser.close()
  }
  writeFileSync(`${OUT}/measures.json`, JSON.stringify(measures, null, 1))
}
main().catch((e) => { console.error(e); process.exit(1) })
