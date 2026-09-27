// Capture the named docs screenshots from the seeded app, in light and dark.
//
// Usage:
//   node capture.mjs                     # every scene, both themes
//   node capture.mjs frames agent        # only these scene groups (or scene names)
//   node capture.mjs --theme dark hero   # one theme
//
// Raw PNGs go to $DOCS_SHOTS_DIR/raw/<theme>/<name>.png; `frame.mjs` turns them
// into the framed WebP files the docs use. To add a screenshot: add a scene
// below (a name and a function that gets the page into shape and calls
// `shot`), then give it a framing region in `manifest.json`.
import { readState, sleep } from "./lib/env.mjs"
import {
  box,
  click,
  clickIcon,
  clickText,
  disconnect,
  escape,
  focusComposer,
  go,
  hoverRow,
  key,
  openRoom,
  openWorkspaceMenu,
  page,
  panels,
  pickTarget,
  selectLayer,
  selectWorkspace,
  setFocusedText,
  setTheme,
  shot as rawShot,
} from "./lib/browser.mjs"

const state = readState()
if (!state.mainRoom) throw new Error("No seeded state — run `node seed.mjs` first.")
const ROOM = state.mainRoom

// Camera presets for the main canvas (x/y in canvas-container px).
const VIEW = {
  overview: { x: 48, y: 110, zoom: 0.262 },
  hero: { x: 16, y: 80, zoom: 0.31 },
  frameCloseUp: { x: 60, y: 96, zoom: 0.62 },
  pricing: { x: 16, y: -250, zoom: 0.31 },
  document: { x: -1080, y: -600, zoom: 0.62 },
  documentEdit: { x: -1150, y: -700, zoom: 0.8 },
}

/** Home-screen card "…" menu (canvas or folder). */
async function cardMenu(p, name, aria = "Canvas actions") {
  const b = await p.evaluate(
    (name, aria) => {
      const leaf = [...document.querySelectorAll("*")].find(
        (e) => e.childElementCount === 0 && e.textContent.trim() === name && e.getBoundingClientRect().x > 300
      )
      let card = leaf
      while (card && !card.querySelector(`button[aria-label='${aria}']`)) card = card.parentElement
      const r = card.getBoundingClientRect()
      const btn = card.querySelector(`button[aria-label='${aria}']`).getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, bx: btn.x + btn.width / 2, by: btn.y + btn.height / 2 }
    },
    name,
    aria
  )
  await p.mouse.move(b.x, b.y)
  await sleep(400)
  await p.mouse.move(b.bx, b.by)
  await sleep(200)
  await p.mouse.click(b.bx, b.by)
  await sleep(900)
}

/** The selected frame's floating toolbar button with a given icon. */
const frameToolbar = (icon) => `button[data-size='icon-xxs']:has(svg.${icon})`

/** A button in a frame's title bar (canvas side), by predicate on its text. */
async function titleBarButton(p, match) {
  const b = await p.evaluate((src) => {
    const test = new Function("t", `return (${src})(t)`)
    const btn = [...document.querySelectorAll("button")].find((b) => {
      const r = b.getBoundingClientRect()
      return r.x > 250 && r.x < 700 && r.y > 40 && r.y < 110 && test(b.innerText.trim())
    })
    if (!btn) return null
    const r = btn.getBoundingClientRect()
    return [r.x + r.width / 2, r.y + r.height / 2]
  }, match.toString())
  if (!b) throw new Error("title bar button not found")
  return b
}

/** The live preview iframe for a route (the widest one wins: the desktop frame). */
async function previewFrame(p, pathname) {
  let best
  for (const f of p.frames()) {
    if (f === p.mainFrame()) continue
    try {
      if (new URL(f.url()).pathname !== pathname) continue
      const el = await f.frameElement()
      const bb = el && (await el.boundingBox())
      if (bb && (!best || bb.width > best.bb.width)) best = { f, bb }
    } catch {}
  }
  if (!best) throw new Error(`no preview frame for ${pathname}`)
  return best
}

// ---------------------------------------------------------------------------
// Scenes: [group, name, async (p, shot) => {}]

const SCENES = [
  // --- Home & settings -------------------------------------------------------
  ["home", "home-recents", async (p, shot) => { await go(p, "/", 6000); await shot("home-recents") }],
  ["home", "home-all-files", async (p, shot) => { await go(p, "/files", 5000); await shot("home-all-files") }],
  ["home", "home-canvas-menu", async (p, shot) => {
    await go(p, "/files", 5000); await cardMenu(p, "Northwind marketing site"); await shot("home-canvas-menu", { keepMouse: true }); await escape(p)
  }],
  ["home", "home-folder-menu", async (p, shot) => {
    await go(p, "/files", 5000); await cardMenu(p, "Marketing", "Folder actions"); await shot("home-folder-menu", { keepMouse: true }); await escape(p)
  }],
  ["home", "home-sort-menu", async (p, shot) => {
    await go(p, "/files", 5000); await clickText(p, "Last edited", { wait: 800 }); await shot("home-sort-menu", { keepMouse: true }); await escape(p)
  }],
  ["home", "home-table", async (p, shot) => {
    await go(p, "/files", 5000)
    await click(p, "button[aria-label='Table view']", null, { wait: 1500 }); await shot("home-table")
    await click(p, "button[aria-label='Grid view']", null, { wait: 800 })
  }],
  ["home", "home-folder", async (p, shot) => { await go(p, "/files", 4000); await clickText(p, "Marketing", { wait: 8000 }); await shot("home-folder") }],
  ["home", "new-canvas-dialog", async (p, shot) => {
    await go(p, "/", 4000); await clickText(p, "New canvas", { wait: 900 }); await p.keyboard.type("Q4 campaign", { delay: 20 })
    await shot("new-canvas-dialog", { keepMouse: true }); await escape(p)
  }],
  ["settings", "settings", async (p, shot) => { await go(p, "/settings", 5000); await shot("settings") }],
  ["settings", "settings-bottom", async (p, shot) => {
    await go(p, "/settings", 5000); await p.mouse.move(700, 400); await p.mouse.wheel({ deltaY: 2000 }); await sleep(800); await shot("settings-bottom")
  }],
  ["settings", "settings-presets", async (p, shot) => {
    await go(p, "/settings", 5000)
    await p.evaluate(() => [...document.querySelectorAll("main button")].find((b) => b.innerText.trim() === "New preset")?.scrollIntoView({ block: "end" }))
    await shot("settings-presets")
  }],
  ["settings", "preset-form", async (p, shot) => {
    await go(p, "/settings", 5000)
    await p.evaluate(() => [...document.querySelectorAll("main button")].find((b) => b.innerText.trim() === "Edit")?.click())
    await sleep(1200)
    await p.evaluate(() => document.querySelector("main input")?.scrollIntoView({ block: "start" }))
    await p.mouse.move(700, 400); await p.mouse.wheel({ deltaY: -120 }); await sleep(600)
    await shot("preset-form")
    await p.evaluate(() => [...document.querySelectorAll("main button")].find((b) => b.innerText.trim() === "Cancel")?.click())
  }],
  ["settings", "setup-gate", async (p, shot) => {
    const cookie = (await p.cookies()).find((c) => c.name === "github_setup_skipped")
    if (cookie) await p.deleteCookie(cookie)
    await go(p, "/", 5000); await shot("setup-gate")
    if (cookie) await p.setCookie(cookie)
    await go(p, "/", 2000)
  }],

  // --- Canvas & sidebar ------------------------------------------------------
  ["canvas", "hero", async (p, shot) => {
    await openRoom(p, ROOM, VIEW.hero); await panels(p, { left: true, right: true })
    await selectWorkspace(p, "hero-gradient"); await sleep(2000); await shot("hero")
  }],
  ["canvas", "canvas-overview", async (p, shot) => {
    await openRoom(p, ROOM, VIEW.overview); await panels(p, { left: true, right: false }); await sleep(1500); await shot("canvas-overview")
  }],
  ["canvas", "canvas-menu", async (p, shot) => {
    await openRoom(p, ROOM, VIEW.hero); await panels(p, { left: true, right: true })
    const b = await p.evaluate(() => {
      const btn = [...document.querySelectorAll("button:has(svg.lucide-ellipsis)")].find((b) => {
        const r = b.getBoundingClientRect(); return r.y < 40 && r.x > 250 && r.x < 700
      })
      const r = btn.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
    })
    await p.mouse.click(b[0], b[1]); await sleep(800); await shot("canvas-menu", { keepMouse: true }); await escape(p)
  }],
  ["canvas", "add-project-menu", async (p, shot) => {
    await openRoom(p, ROOM, VIEW.hero); await panels(p, { left: true, right: true })
    await clickIcon(p, "lucide-folder-plus", { wait: 900 }); await shot("add-project-menu", { keepMouse: true }); await escape(p)
  }],
  ["canvas", "configure-project", async (p, shot) => {
    await openRoom(p, ROOM, VIEW.hero); await panels(p, { left: true, right: true })
    await clickIcon(p, "lucide-folder-plus", { wait: 900 }); await clickText(p, "Open project", { wait: 1500 })
    await p.focus("[role=dialog] input"); await setFocusedText(p, (await import("./lib/env.mjs")).DEMO_DIR)
    await click(p, "[role=dialog] button", "Add", { wait: 7000 }); await clickText(p, "Advanced", { wait: 800 })
    await shot("configure-project", { keepMouse: true }); await click(p, "[role=dialog] button", "Cancel", { wait: 800 })
  }],
  ["canvas", "project-menu", async (p, shot) => {
    await openRoom(p, ROOM, VIEW.hero); await panels(p, { left: true, right: true })
    await hoverRow(p, "northwind-web", "[class*='group/workspace-row']")
    await click(p, "[class*='group/workspace-row'] button[title=More]", null, { wait: 900 }); await shot("project-menu", { keepMouse: true })
    await clickText(p, "Settings", { wait: 1500 }); await shot("project-settings", { keepMouse: true }); await escape(p)
  }],
  ["canvas", "ws-menu", async (p, shot) => {
    await openRoom(p, ROOM, VIEW.hero); await panels(p, { left: true, right: true })
    await openWorkspaceMenu(p, "hero-gradient"); await shot("ws-menu", { keepMouse: true })
    await clickText(p, "Restart", { hover: true, wait: 900 }); await shot("ws-restart", { keepMouse: true })
    await clickText(p, "Recreate from scratch", { wait: 1200 }); await shot("recreate-dialog", { keepMouse: true })
    await clickText(p, "Cancel", { wait: 600 }); await escape(p)
    await openWorkspaceMenu(p, "hero-gradient"); await clickText(p, "Color", { hover: true, wait: 900 }); await shot("ws-color", { keepMouse: true }); await escape(p)
    await openWorkspaceMenu(p, "customer-stories"); await clickText(p, "Delete", { wait: 1200 }); await shot("delete-branch-dialog", { keepMouse: true })
    await clickText(p, "Cancel", { wait: 600 }); await escape(p)
  }],
  ["canvas", "new-workspace-multi", async (p, shot) => {
    await openRoom(p, ROOM, VIEW.hero); await panels(p, { left: true, right: true })
    await hoverRow(p, "northwind-web", "[class*='group/workspace-row']")
    await click(p, "button[title='New Workspace']", null, { wait: 1500 })
    await click(p, "[role=dialog] [contenteditable=true]")
    await p.keyboard.type("Add a monthly/annual toggle to the pricing page with 20% off annual plans", { delay: 2 })
    await click(p, "[role=dialog] button", "Add another", { wait: 800 })
    await p.keyboard.type("Redesign the customer quotes as a carousel", { delay: 2 }); await sleep(400)
    await shot("new-workspace-multi", { keepMouse: true }); await clickText(p, "Cancel", { wait: 800 }); await escape(p)
  }],

  // --- Frames ----------------------------------------------------------------
  ["frames", "frame-selected", async (p, shot) => {
    await openRoom(p, ROOM, VIEW.frameCloseUp); await panels(p, { left: true, right: false })
    await selectLayer(p, "Home"); await shot("frame-selected")
    const interact = await box(p, frameToolbar("lucide-mouse-pointer"))
    await p.mouse.move(interact.x, interact.y); await sleep(900); await shot("frame-tooltip-interact", { keepMouse: true })
    await click(p, frameToolbar("lucide-ellipsis"), null, { wait: 900 }); await shot("frame-more-menu", { keepMouse: true })
    await clickText(p, "Device size", { hover: true, wait: 900 }); await shot("device-size-menu", { keepMouse: true }); await escape(p)
    await selectLayer(p, "Home"); await click(p, frameToolbar("lucide-sliders-horizontal"), null, { wait: 1500 })
    await shot("knobs-popover", { keepMouse: true }); await escape(p)
    const route = await titleBarButton(p, (t) => t === "/")
    await p.mouse.click(route[0], route[1]); await sleep(900); await shot("route-picker", { keepMouse: true }); await escape(p)
    const badge = await titleBarButton(p, (t) => t.startsWith("h"))
    await p.mouse.click(badge[0], badge[1]); await sleep(900); await shot("frame-branch-picker", { keepMouse: true }); await escape(p)
  }],
  ["frames", "frame-tool", async (p, shot) => {
    await openRoom(p, ROOM, VIEW.frameCloseUp); await panels(p, { left: true, right: false })
    await key(p, "f"); await p.mouse.move(640, 700); await sleep(400); await shot("frame-tool", { keepMouse: true }); await escape(p)
  }],

  // --- Agent panel -----------------------------------------------------------
  ["agent", "target-picker", async (p, shot) => {
    await openRoom(p, ROOM, VIEW.hero); await panels(p, { left: true, right: true }); await selectWorkspace(p, "hero-gradient")
    await pickTarget(p); await shot("target-picker", { keepMouse: true }); await escape(p)
    await click(p, "button[title='New chat or terminal']", null, { wait: 900 }); await shot("new-tab-menu", { keepMouse: true }); await escape(p)
  }],
  ["agent", "composer", async (p, shot) => {
    await openRoom(p, ROOM, VIEW.hero); await panels(p, { left: true, right: true }); await selectWorkspace(p, "hero-gradient")
    const clear = async () => { await focusComposer(p); await key(p, "a", "Control"); await key(p, "Backspace") }
    await focusComposer(p); await p.keyboard.type("Match the headline style on ", { delay: 5 }); await p.keyboard.type("@"); await sleep(1200)
    await shot("composer-mention", { keepMouse: true }); await escape(p, 1); await clear()
    await p.keyboard.type("/"); await sleep(1500); await shot("composer-skills", { keepMouse: true }); await escape(p, 1); await clear()
    await p.keyboard.type("Make ", { delay: 5 })
    await clickIcon(p, "lucide-crosshair", { wait: 1000 })
    const { f, bb } = await previewFrame(p, "/")
    const target = await f.evaluate(() => {
      const a = [...document.querySelectorAll("a")].find((a) => a.textContent.includes("Start free trial"))
      const r = a.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
    })
    const scale = bb.width / 1280
    await p.mouse.move(bb.x + target[0] * scale, bb.y + target[1] * scale); await sleep(900)
    await shot("target-picking", { keepMouse: true })
    await p.mouse.click(bb.x + target[0] * scale, bb.y + target[1] * scale); await sleep(1200)
    await p.keyboard.type(" bigger and add an arrow icon after the label", { delay: 8 }); await sleep(600)
    const token = await box(p, "[data-type='element-token'], span[data-element-token], .element-token")
    if (token) { await p.mouse.move(token.x, token.y); await sleep(1000) }
    await shot("composer-element-hover", { keepMouse: true })
    await clear()
  }],
  ["agent", "logs", async (p, shot) => {
    await openRoom(p, ROOM, VIEW.hero); await panels(p, { left: true, right: true }); await selectWorkspace(p, "hero-gradient")
    await click(p, "button[aria-label='Sandbox logs']", null, { wait: 2500 }); await shot("logs")
  }],
  ["agent", "plan-card", async (p, shot) => {
    await openRoom(p, ROOM, VIEW.pricing); await panels(p, { left: true, right: true }); await selectWorkspace(p, "pricing-faq"); await sleep(1500)
    await p.evaluate(() => {
      const el = [...document.querySelectorAll("*")].find((e) => e.childElementCount === 0 && e.textContent.trim().startsWith("Add an FAQ section"))
      el?.scrollIntoView({ block: "start" })
    })
    await sleep(800); await shot("plan-card")
  }],
  ["agent", "doc-chat", async (p, shot) => {
    await openRoom(p, ROOM, VIEW.document); await panels(p, { left: true, right: true })
    await pickTarget(p, "Pricing launch checklist"); await sleep(1500); await shot("doc-chat")
  }],
  ["agent", "doc-selection-toolbar", async (p, shot) => {
    await openRoom(p, ROOM, VIEW.documentEdit); await panels(p, { left: true, right: false })
    const line = await p.evaluate(() => {
      const el = [...document.querySelectorAll("li p, li")].find((e) => e.textContent.trim().startsWith("Annual toggle QA"))
      const r = el.getBoundingClientRect(); return [r.x + 20, r.y + r.height / 2]
    })
    await p.mouse.click(line[0], line[1], { clickCount: 2 }); await sleep(1200)
    await p.mouse.click(line[0], line[1], { clickCount: 3 }); await sleep(1000)
    await shot("doc-selection-toolbar", { keepMouse: true }); await escape(p, 3)
  }],
  ["agent", "terminal", async (p, shot) => {
    await openRoom(p, ROOM, VIEW.hero); await panels(p, { left: true, right: true }); await selectWorkspace(p, "customer-stories")
    await sleep(3000) // terminal tabs are restored asynchronously
    const xtermVisible = () => p.evaluate(() => [...document.querySelectorAll(".xterm")].some((e) => e.getBoundingClientRect().width > 100))
    if (await box(p, "button[role=tab]", "Terminal")) await click(p, "button[role=tab]", "Terminal", { wait: 6000 })
    if (!(await xtermVisible())) {
      await click(p, "button[title='New chat or terminal']", null, { wait: 900 })
      await clickText(p, "New terminal", { wait: 12000 })
    }
    if (!(await xtermVisible())) throw new Error("terminal didn't open")
    await shot("terminal")
  }],

  // --- Play mode -------------------------------------------------------------
  ["play", "play", async (p, shot) => {
    const url = `/play/${ROOM}/${state.heroBranchId}?route=/`
    const hud = async (icon) => { const b = await box(p, `button:has(svg.${icon})`); if (!b) throw new Error(`HUD ${icon}`); return b }
    await go(p, url, 9000); await shot("play-desktop")
    const knobs = await hud("lucide-sliders-horizontal")
    await p.mouse.move(knobs.x, knobs.y); await sleep(900); await shot("play-hud", { keepMouse: true })
    await p.mouse.click(knobs.x, knobs.y); await sleep(1200); await shot("play-knobs", { keepMouse: true }); await p.mouse.click(knobs.x, knobs.y); await sleep(600)
    const agent = await hud("lucide-messages-square")
    await p.mouse.click(agent.x, agent.y); await sleep(2500); await shot("play-agent", { keepMouse: true }); await p.mouse.click(agent.x, agent.y); await sleep(600)
    const device = await box(p, "button[aria-label^='Device']")
    await p.mouse.click(device.x, device.y); await sleep(900); await shot("play-device-menu", { keepMouse: true })
    await click(p, "[role=option],[role=menuitem],[role=menuitemradio],button", "iPhone 17 Pro", { wait: 3000 })
    await p.mouse.move(640, 790); await sleep(500); await shot("play-mobile", { keepMouse: true })
    await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (/device|play/i.test(k)) localStorage.removeItem(k) })
  }],
]

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const themeIdx = argv.indexOf("--theme")
const themes = themeIdx >= 0 ? [argv[themeIdx + 1]] : ["light", "dark"]
const filters = argv.filter((a, i) => a !== "--theme" && i !== themeIdx + 1)
const selected = SCENES.filter(([group, name]) => !filters.length || filters.includes(group) || filters.includes(name))

const p = await page()
const failures = []
for (const theme of themes) {
  console.log(`• ${theme}`)
  await setTheme(p, theme)
  const shot = (name, opts) => rawShot(p, `${theme}/${name}`, opts)
  for (const [, name, run] of selected) {
    try {
      await run(p, shot)
    } catch (e) {
      failures.push(`${theme}/${name}: ${e.message}`)
      console.warn(`  ✗ ${name}: ${e.message}`)
      await escape(p, 3).catch(() => {})
    }
  }
}
await setTheme(p, "light")
await disconnect()
if (failures.length) {
  console.error(`\n${failures.length} scene(s) failed:\n  ${failures.join("\n  ")}`)
  process.exitCode = 1
}
