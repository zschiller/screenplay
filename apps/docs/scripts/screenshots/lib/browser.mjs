// Browser control for seeding and capture.
//
// Chrome runs *headed*: headless Chrome reports `(hover: none)`, which hides
// every hover-revealed control (the sidebar's "…" menus, "+ New Workspace").
// On Linux without a display we start Xvfb for it. One long-lived browser is
// shared by every step (connected over CDP), so the canvas isn't reloaded
// between shots.
import { spawn, execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import {
  APP_URL,
  CDP_PORT,
  LOG_DIR,
  RAW_DIR,
  VIEWPORT,
  WORK_DIR,
  appRequire,
  chromePath,
  sleep,
} from "./env.mjs"
import { getViewport, setViewport } from "./ydoc.mjs"

const puppeteer = appRequire("puppeteer-core")

async function cdpUp() {
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
    return r.ok
  } catch {
    return false
  }
}

/** Start (or reuse) the shared headed Chrome. */
export async function ensureBrowser() {
  if (await cdpUp()) return
  const env = { ...process.env }
  if (process.platform === "linux" && !env.DISPLAY) {
    const display = ":99"
    const xvfb = spawn("Xvfb", [display, "-screen", "0", "1440x960x24"], {
      detached: true,
      stdio: "ignore",
    })
    xvfb.unref()
    env.DISPLAY = display
    await sleep(800)
  }
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${path.join(WORK_DIR, "chrome-profile")}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height + 120}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--disable-features=Translate",
    "about:blank",
  ]
  if (process.getuid?.() === 0) args.unshift("--no-sandbox")
  const out = fs.openSync(path.join(LOG_DIR, "chrome.log"), "a")
  spawn(chromePath(), args, { env, detached: true, stdio: ["ignore", out, out] }).unref()
  for (let i = 0; i < 60 && !(await cdpUp()); i++) await sleep(500)
  if (!(await cdpUp())) throw new Error("Chrome did not start — see logs/chrome.log")
}

let browser
/** Connect to the shared browser and return its page, sized for capture. */
export async function page() {
  await ensureBrowser()
  browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${CDP_PORT}`,
    defaultViewport: null,
  })
  // Chrome's initial tab can appear a moment after CDP is up; wait for it, and
  // keep exactly one tab (a stray tab on a canvas keeps saving its viewport).
  let pages = await browser.pages()
  for (let i = 0; i < 20 && !pages.length; i++) {
    await sleep(250)
    pages = await browser.pages()
  }
  const p = pages[0] ?? (await browser.newPage())
  for (const extra of pages.slice(1)) await extra.close()
  await p.setViewport({ ...VIEWPORT, deviceScaleFactor: 2 })
  return p
}
export const disconnect = () => browser?.disconnect()

export async function stopBrowser() {
  try {
    execSync(`pkill -f -- "--remote-debugging-port=${CDP_PORT}"`)
  } catch {}
  // Wait until the old instance has really gone, or the next step can attach
  // to a browser that is mid-shutdown.
  for (let i = 0; i < 40 && (await cdpUp()); i++) await sleep(250)
}

// ---------------------------------------------------------------------------
// Navigation & capture

export async function go(p, route, wait = 6000) {
  await p
    .goto(APP_URL + route, { waitUntil: "networkidle2", timeout: 120000 })
    .catch((e) => console.warn(`  goto ${route}: ${e.message}`))
  await sleep(wait)
}

/** Load a canvas with its camera set to `viewport` (see `setViewport`). */
export async function openRoom(p, roomId, viewport, wait = 9000) {
  // An open canvas persists its own camera, and a page load can race our write
  // (the previous camera wins). So: leave the canvas, write, load, then verify
  // the stored camera and retry until it sticks.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (viewport) {
      await p.goto("about:blank")
      await sleep(1500)
      await setViewport(roomId, viewport)
      await sleep(1500)
    }
    await go(p, `/${roomId}`, wait)
    await waitForPaint(p)
    if (!viewport) return
    const stored = await getViewport(roomId)
    const same = stored && ["x", "y", "zoom"].every((k) => Math.abs(stored[k] - viewport[k]) < 0.01)
    if (same) return
  }
  console.warn(`  ! camera for ${roomId} didn't stick`)
}

/** Wait until the canvas has painted its frames. */
async function waitForPaint(p) {
  for (let i = 0; i < 20; i++) {
    const painted = await p.evaluate(() =>
      [...document.querySelectorAll("iframe")].some((f) => {
        const r = f.getBoundingClientRect()
        return r.width > 40 && r.right > 250 && r.left < innerWidth
      })
    )
    if (painted) break
    await sleep(1000)
  }
  await sleep(1500)
}

async function hideDevOverlay(p) {
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {})
}

/** Screenshot the viewport into raw/<theme>/<name>.png, parking the mouse first. */
export async function shot(p, name, { keepMouse = false } = {}) {
  await hideDevOverlay(p)
  if (!keepMouse) await p.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1)
  await sleep(400)
  const file = path.join(RAW_DIR, `${name}.png`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await p.screenshot({ path: file })
  console.log(`  ✓ ${name}`)
}

// ---------------------------------------------------------------------------
// Finding and clicking things

/** Center of the first visible element matching `sel` (optionally by leading text). */
export function box(p, sel, text) {
  return p.evaluate(
    (sel, text) => {
      const visible = (e) => e.getClientRects().length > 0
      const label = (e) => (e.innerText || e.getAttribute("aria-label") || e.title || "").trim()
      const el = [...document.querySelectorAll(sel)].find(
        (e) => visible(e) && (!text || label(e).startsWith(text))
      )
      if (!el) return null
      const r0 = el.getBoundingClientRect()
      if (r0.bottom > innerHeight || r0.top < 0) el.scrollIntoView({ block: "center" })
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.x, top: r.y, w: r.width, h: r.height }
    },
    sel,
    text
  )
}

export async function click(p, sel, text, { wait = 700, hover = false } = {}) {
  const b = await box(p, sel, text)
  if (!b) throw new Error(`Not found: ${sel}${text ? ` "${text}"` : ""}`)
  if (hover) {
    await p.mouse.move(b.x, b.y)
    await sleep(300)
  }
  await p.mouse.click(b.x, b.y)
  await sleep(wait)
}

const CLICKABLE =
  "button,a,[role=menuitem],[role=menuitemradio],[role=option],[role=tab],label,[cmdk-item]"
export const clickText = (p, text, opts) => click(p, CLICKABLE, text, opts)

/** Click the button containing a given lucide icon (e.g. "lucide-folder-plus"). */
export const clickIcon = (p, icon, opts) => click(p, `button:has(svg.${icon})`, null, opts)

export async function key(p, k, mod) {
  if (mod) await p.keyboard.down(mod)
  await p.keyboard.press(k)
  if (mod) await p.keyboard.up(mod)
  await sleep(450)
}
export const escape = async (p, times = 2) => {
  for (let i = 0; i < times; i++) await key(p, "Escape")
}

/** Replace the focused input/textarea/contenteditable's text (no per-key typing). */
export async function setFocusedText(p, value) {
  await p.evaluate((value) => {
    const el = document.activeElement
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
      const proto = el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value)
      el.dispatchEvent(new Event("input", { bubbles: true }))
    } else if (el?.isContentEditable) {
      const r = document.createRange()
      r.selectNodeContents(el)
      const s = getSelection()
      s.removeAllRanges()
      s.addRange(r)
      document.execCommand("insertText", false, value)
    }
  }, value)
  await sleep(250)
}

export const bodyText = (p) => p.evaluate(() => document.body.innerText)

/** Wait until `pred(bodyText)` holds (polling), or time out. */
export async function waitForText(p, pred, { timeout = 180000, every = 2000 } = {}) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (pred(await bodyText(p))) return true
    await sleep(every)
  }
  throw new Error("waitForText timed out")
}

/** Wait for the agent to finish a turn (no Stop button for a few polls). */
export async function waitForAgentIdle(p, { timeout = 240000 } = {}) {
  const end = Date.now() + timeout
  let idle = 0
  while (Date.now() < end && idle < 3) {
    const busy = await p.evaluate(() => !!document.querySelector("button[title=Stop]"))
    idle = busy ? 0 : idle + 1
    await sleep(1500)
  }
  await sleep(2000)
}

// ---------------------------------------------------------------------------
// Canvas-specific helpers

/** Show/hide the left sidebar and agent panel via their collapse buttons. */
export async function panels(p, { left, right }) {
  const find = (icon) =>
    p.evaluate((icon) => {
      const s = [...document.querySelectorAll(`svg.${icon}`)].find((s) => {
        const r = s.getBoundingClientRect()
        return r.width && r.x >= 0 && r.x < innerWidth
      })
      if (!s) return null
      const r = s.closest("button").getBoundingClientRect()
      return [r.x + r.width / 2, r.y + r.height / 2]
    }, icon)
  const toggle = async (open, closeIcon, openIcon) => {
    if (open === undefined) return
    const isOpen = !!(await find(closeIcon))
    if (isOpen === open) return
    const b = await find(open ? openIcon : closeIcon)
    if (b) await p.mouse.click(b[0], b[1])
    await sleep(900)
  }
  await toggle(right, "lucide-panel-right-close", "lucide-panel-right-open")
  await toggle(left, "lucide-panel-left-close", "lucide-panel-left-open")
  await p.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1)
}

/** Hover a sidebar row (workspace rows are `group/branch-row`, projects `group/workspace-row`). */
export async function hoverRow(p, text, rowSel = "[class*='group/branch-row']") {
  const b = await p.evaluate(
    (text, rowSel) => {
      const row = [...document.querySelectorAll(rowSel)].find((e) => e.innerText.includes(text))
      if (!row) return null
      const r = row.getBoundingClientRect()
      return [r.x + 60, r.y + r.height / 2]
    },
    text,
    rowSel
  )
  if (!b) throw new Error(`No sidebar row "${text}"`)
  await p.mouse.move(b[0], b[1])
  await sleep(500)
}

/** Open a workspace row's "…" menu. */
export async function openWorkspaceMenu(p, name) {
  await hoverRow(p, name)
  const b = await p.evaluate((name) => {
    const row = [...document.querySelectorAll("[class*='group/branch-row']")].find((e) => e.innerText.includes(name))
    const btn = [...row.querySelectorAll("button")].find((b) => b.querySelector("svg.lucide-ellipsis"))
    const r = btn.getBoundingClientRect()
    return [r.x + r.width / 2, r.y + r.height / 2]
  }, name)
  await p.mouse.move(b[0], b[1])
  await sleep(200)
  await p.mouse.click(b[0], b[1])
  await sleep(800)
}

/** Click a workspace row to make it the agent panel's target. */
export async function selectWorkspace(p, name) {
  const b = await p.evaluate((name) => {
    const row = [...document.querySelectorAll("[class*='group/branch-row']")].find((e) => e.innerText.includes(name))
    const r = row.getBoundingClientRect()
    return [r.x + 40, r.y + r.height / 2]
  }, name)
  await p.mouse.click(b[0], b[1])
  await sleep(1500)
}

/** Click a frame/document title on the canvas (not in the sidebar) to select it. */
export async function selectLayer(p, title) {
  const b = await p.evaluate((title) => {
    const el = [...document.querySelectorAll("span,div")].find(
      (e) => e.childElementCount === 0 && e.textContent.trim() === title && e.getBoundingClientRect().x > 250
    )
    if (!el) return null
    const r = el.getBoundingClientRect()
    return [r.x + r.width / 2, r.y + r.height / 2]
  }, title)
  if (!b) throw new Error(`No canvas layer titled "${title}"`)
  await p.mouse.click(b[0], b[1])
  await sleep(900)
}

/** Click the agent panel's composer and focus it. */
export async function focusComposer(p) {
  const b = await p.evaluate(() => {
    const eds = [...document.querySelectorAll("[contenteditable=true]")]
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.x > 800 && r.width)
    const r = eds.pop()
    return r && [r.x + 60, r.y + 10]
  })
  if (!b) throw new Error("No composer")
  await p.mouse.click(b[0], b[1])
  await sleep(300)
}

/** Open the agent panel's target picker and pick a target by label. */
export async function pickTarget(p, label) {
  const b = await p.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.querySelector("svg.lucide-chevrons-up-down") && b.getBoundingClientRect().x > 800 && b.getBoundingClientRect().y < 40
    )
    const r = btn.getBoundingClientRect()
    return [r.x + r.width / 2, r.y + r.height / 2]
  })
  await p.mouse.click(b[0], b[1])
  await sleep(1000)
  if (label) await click(p, "[cmdk-item],[role=option]", label, { wait: 1500 })
}

/** Set the app theme (Settings → Appearance), which persists per browser. */
export async function setTheme(p, theme) {
  await go(p, "/settings", 3000)
  await clickText(p, theme === "dark" ? "Dark" : "Light", { wait: 800 })
}
