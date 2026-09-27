// Build the scene the docs screenshots are taken from, from a fresh local
// build: the "Northwind marketing site" canvas with three workspaces (two with
// real agent turns, one plan-mode), a document, a tidy layout, plus a few more
// canvases filed into folders, pins, and a named project preset.
//
// Usage: node seed.mjs   (expects `node boot.mjs` to have run)
import { DEMO_DIR, sleep, writeState } from "./lib/env.mjs"
import {
  bodyText,
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
  setFocusedText,
  setTheme,
  waitForAgentIdle,
  waitForText,
} from "./lib/browser.mjs"
import { editRoom, newId, readRoom, setRecord } from "./lib/ydoc.mjs"

const PROMPTS = {
  hero: 'Make the hero headline use a gradient from the accent color to cyan, and add a small "Trusted by 4,000+ product teams" line under the buttons.',
  faq: "Add an FAQ section below the pricing cards with four common questions.",
  doc: "Turn this into a launch checklist for the new pricing page.",
}

const settled = (t) =>
  !t.includes("Waiting for dev server") && !t.includes("Waiting for the sandbox") && !/creating\.\.\./.test(t)

async function passSetupGate(p) {
  await go(p, "/", 5000)
  if (!(await bodyText(p)).includes("Set up Screenplay")) return
  await clickText(p, "Skip for now", { wait: 2500 })
  await clickText(p, "Finish", { wait: 5000 })
}

async function newCanvas(p, name) {
  await go(p, "/", 3000)
  await clickText(p, "New canvas", { wait: 900 })
  await setFocusedText(p, name)
  await click(p, "[role=dialog] button", "Create", { wait: 8000 })
  const roomId = new URL(p.url()).pathname.slice(1)
  await panels(p, { left: true })
  return roomId
}

/** Add the demo repo by local folder, saving it as a preset. Creates one workspace. */
async function addProjectFromFolder(p) {
  await clickIcon(p, "lucide-folder-plus", { wait: 900 })
  await clickText(p, "Open project", { wait: 1500 })
  await p.focus("[role=dialog] input")
  await setFocusedText(p, DEMO_DIR)
  await click(p, "[role=dialog] button", "Add", { wait: 1000 })
  await waitForText(p, (t) => t.includes("Configure project") && !t.includes("Detecting settings"))
  await click(p, "[role=dialog] button", "Add project", { wait: 4000 })
  await waitForText(p, settled)
}

/** Add the demo repo from its saved preset (one click). Creates one workspace. */
async function addProjectFromPreset(p) {
  await clickIcon(p, "lucide-folder-plus", { wait: 900 })
  await clickText(p, "Open GitHub project", { wait: 2500 })
  await click(p, "[role=dialog] [cmdk-item],[role=dialog] [role=option]", "northwind-web", { wait: 4000 })
  await waitForText(p, settled)
}

/** Create a workspace from the "Create branches" dialog with a seed prompt. */
async function newWorkspace(p, prompt, { plan = false } = {}) {
  await hoverRow(p, "northwind-web", "[class*='group/workspace-row']")
  await click(p, "button[title='New Workspace']", null, { wait: 1500 })
  await click(p, "[role=dialog] [contenteditable=true]")
  await p.keyboard.type(prompt, { delay: 2 })
  if (plan) await click(p, "[role=dialog] button[title='Enable plan mode']", null, { wait: 400 })
  await click(p, "[role=dialog] button", "Create branch", { wait: 6000 })
}

async function workspaceMenu(p, name, item, sub) {
  await openWorkspaceMenu(p, name)
  await clickText(p, item, { hover: !!sub, wait: 800 })
  if (sub) await clickText(p, sub, { wait: 800 })
}

async function typeDocument(p) {
  await clickIcon(p, "lucide-file-text", { wait: 500 })
  await p.mouse.click(620, 180)
  await sleep(1800)
  const type = (s) => p.keyboard.type(s, { delay: 4 })
  await type("Pricing launch checklist")
  await key(p, "Enter")
  await type("Target launch: **Tuesday, Oct 6**. Owner: Growth team.")
  const section = async (heading, items) => {
    await key(p, "Enter")
    await type(`## ${heading}`)
    await key(p, "Enter")
    await type("- ")
    for (const [i, item] of items.entries()) {
      await type(item)
      if (i < items.length - 1) await key(p, "Enter")
    }
    await key(p, "Enter")
    await key(p, "Enter") // leave the list
  }
  await section("Before launch", [
    "Final copy review for all three plans",
    "Annual toggle QA on mobile (iPhone 17 Pro, Pixel 9)",
    "FAQ answers signed off by Support",
    "Update Stripe prices for annual billing",
  ])
  await section("Launch day", [
    "Merge the pricing and FAQ branches",
    "Announce in the changelog and newsletter",
    "Watch the Pricing → Signup funnel in Northwind",
  ])
  await section("After launch", ["Compare conversion week over week", "Collect feedback from the sales team"])
  await escape(p)
}

/** Arrange the main canvas: Homepage + Pricing groups (desktop + phone), Customers, Notes. */
async function layoutMainCanvas(roomId) {
  const state = await readRoom(roomId)
  const byRef = Object.fromEntries(Object.values(state.branches).map((b) => [b.ref, b.id]))
  await editRoom(roomId, (doc, Y) => {
    const layers = doc.getMap("iframeLayers")
    const groups = doc.getMap("iframeLayerGroups")
    const md = doc.getMap("markdownLayers")
    const branches = doc.getMap("branches")
    const firstFrameOf = (bid) => [...layers.values()].map((l) => l.toJSON()).find((l) => l.branchId === bid)
    const frame = (bid, label, route, width, height, reuse) => {
      const id = reuse?.id ?? newId()
      setRecord(Y, layers, id, { id, branchId: bid, label, route, width, height, iframeState: reuse?.iframeState ?? {} })
      return { kind: "iframe-layer", id }
    }
    const hero = byRef["hero-gradient-trust-line"], faq = byRef["pricing-faq"], cust = byRef["customer-stories"]
    const members = {
      home: [frame(hero, "Home", "/", 1280, 800, firstFrameOf(hero)), frame(hero, "Home · mobile", "/", 402, 874)],
      pricing: [frame(faq, "Pricing", "/pricing", 1280, 800, firstFrameOf(faq)), frame(faq, "Pricing · mobile", "/pricing", 402, 874)],
      customers: [frame(cust, "Customers", "/customers", 1280, 800, firstFrameOf(cust))],
    }
    const docId = [...md.keys()][0]
    md.get(docId).set("width", 520)
    md.get(docId).set("height", 700)
    for (const k of [...groups.keys()]) groups.delete(k)
    const group = (name, x, y, m, order) => {
      const id = newId()
      setRecord(Y, groups, id, { id, name, x, y, gap: 48, members: m, sidebarOrder: order })
    }
    group("Homepage", 0, 0, members.home, 0)
    group("Pricing", 0, 1080, members.pricing, 1)
    group("Customer stories", 1860, 0, members.customers, 2)
    group("Notes", 1860, 1080, [{ kind: "markdown-layer", id: docId }], 3)
    const routes = [
      { route: "/", label: "Home" },
      { route: "/pricing", label: "Pricing" },
      { route: "/customers", label: "Customers" },
    ]
    for (const b of branches.values()) b.set("discoveredRoutes", routes)
    // A seeded workspace can end up with an extra empty "Untitled" chat tab
    // beside its real chat; drop those so the tab strips stay tidy.
    const chats = doc.getMap("chatSessions")
    const labelled = new Set([...chats.values()].map((c) => c.toJSON()).filter((c) => c.label !== "Untitled").map((c) => c.branchId))
    for (const [id, c] of [...chats.entries()]) {
      const v = c.toJSON()
      if (v.label === "Untitled" && v.branchId && labelled.has(v.branchId)) chats.delete(id)
    }
  })
  return byRef
}

/** One group of frames for a secondary canvas. */
async function layoutSimpleCanvas(roomId, groupName, frames, colorIndex) {
  await editRoom(roomId, (doc, Y) => {
    const branches = doc.getMap("branches")
    const layers = doc.getMap("iframeLayers")
    const groups = doc.getMap("iframeLayerGroups")
    const [bid] = [...branches.keys()]
    const existing = [...layers.keys()]
    for (const k of [...groups.keys()]) groups.delete(k)
    const members = frames.map(([label, route, w, h], i) => {
      const id = existing[i] ?? newId()
      setRecord(Y, layers, id, { id, branchId: bid, label, route, width: w, height: h, iframeState: {} })
      return { kind: "iframe-layer", id }
    })
    const gid = newId()
    setRecord(Y, groups, gid, { id: gid, name: groupName, x: 0, y: 0, gap: 48, members, sidebarOrder: 0 })
    branches.get(bid).set("colorIndex", colorIndex)
  })
}

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

async function moveTo(p, name, folder) {
  await cardMenu(p, name)
  await clickText(p, "Move to", { wait: 900 })
  await click(p, "[role=dialog] button,[role=dialog] [role=option],[role=dialog] li", folder, { wait: 500 })
  await click(p, "[role=dialog] button", "Move", { wait: 2000 })
}

// ---------------------------------------------------------------------------

const p = await page()
await passSetupGate(p)
await setTheme(p, "light")

console.log("• Main canvas")
const mainRoom = await newCanvas(p, "Northwind marketing site")
await addProjectFromFolder(p)
// The project's first workspace becomes "customer-stories".
const [firstRef] = Object.values((await readRoom(mainRoom)).branches).map((b) => b.ref)
await workspaceMenu(p, firstRef, "Rename")
await setFocusedText(p, "customer-stories")
await key(p, "Enter")

console.log("• Workspace with an agent turn (hero)")
await newWorkspace(p, PROMPTS.hero)
await waitForText(p, (t) => t.includes("hero-gradient-trust-line") && settled(t))
await waitForAgentIdle(p)

console.log("• Plan-mode workspace (pricing FAQ)")
await newWorkspace(p, PROMPTS.faq, { plan: true })
await waitForText(p, (t) => t.includes("Approve"), { timeout: 240000 })
await clickText(p, "Approve", { wait: 3000 })
await waitForAgentIdle(p)

console.log("• Workspace colors")
await workspaceMenu(p, "hero-gradient", "Color", "Orange")
await workspaceMenu(p, "pricing-faq", "Color", "Emerald")
await workspaceMenu(p, "customer-stories", "Color", "Sky")

console.log("• Document + document chat")
await panels(p, { left: true, right: false })
await typeDocument(p)
await panels(p, { right: true })
await pickTarget(p, "Pricing launch checklist")
await focusComposer(p)
await p.keyboard.type(PROMPTS.doc, { delay: 3 })
await key(p, "Enter")
await waitForAgentIdle(p)
// Document chats aren't auto-named on the desktop engine; label it like one.
await editRoom(mainRoom, (doc) => {
  for (const chat of doc.getMap("chatSessions").values())
    if (chat.get("markdownLayerId")) chat.set("label", "Launch Checklist")
})

console.log("• Layout")
const branchIds = await layoutMainCanvas(mainRoom)

console.log("• More canvases")
const rooms = {}
for (const [name, group, frames, color] of [
  ["Onboarding flow", "Onboarding", [["Welcome", "/", 402, 874], ["Plans", "/pricing", 402, 874], ["Stories", "/customers", 402, 874]], 13],
  ["Pricing experiments", "Pricing", [["Pricing", "/pricing", 1280, 800], ["Pricing · mobile", "/pricing", 402, 874]], 4],
  ["Customer stories page", "Customers", [["Customers", "/customers", 1280, 800]], 15],
]) {
  rooms[name] = await newCanvas(p, name)
  await addProjectFromPreset(p)
  await layoutSimpleCanvas(rooms[name], group, frames, color)
  await openRoom(p, rooms[name], { x: 40, y: 80, zoom: 0.4 }, 45000) // let thumbnails capture
}
await openRoom(p, mainRoom, { x: 48, y: 110, zoom: 0.262 }, 45000)

console.log("• Folders, filing, pins")
await go(p, "/files", 5000)
for (const f of ["Marketing", "Product"]) {
  await clickText(p, "Add folder", { wait: 900 })
  await setFocusedText(p, f)
  await click(p, "[role=dialog] button", "Create", { wait: 2500 })
}
await moveTo(p, "Pricing experiments", "Marketing")
await moveTo(p, "Customer stories page", "Marketing")
await moveTo(p, "Onboarding flow", "Product")
await cardMenu(p, "Northwind marketing site")
await clickText(p, "Pin to sidebar", { wait: 1200 })
await cardMenu(p, "Marketing", "Folder actions")
await clickText(p, "Pin to sidebar", { wait: 1200 })

console.log("• Preset name")
await go(p, "/settings", 4000)
await p.evaluate(() => [...document.querySelectorAll("main button")].find((b) => b.innerText.trim() === "Edit")?.click())
await sleep(1200)
await p.focus("main input[placeholder='default']")
await setFocusedText(p, "web")
await p.evaluate(() => [...document.querySelectorAll("main button")].find((b) => b.innerText.trim() === "Save changes")?.click())
await sleep(2000)

writeState({
  mainRoom,
  rooms,
  heroBranchId: branchIds["hero-gradient-trust-line"],
  seededAt: new Date().toISOString(),
})
console.log("• Seed complete")
await disconnect()
