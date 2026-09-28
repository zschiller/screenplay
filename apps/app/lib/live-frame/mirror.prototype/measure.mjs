// PROTOTYPE (#982): drive the host and watcher tabs with Playwright and write
// what came through, what broke, and what it cost to results/. Run serve.mjs
// first. Every check prints one line; results/results.json has the numbers.
import { mkdir, writeFile } from "node:fs/promises"
import { chromium } from "playwright-core"

const APP = "http://127.0.0.1:4100"
const OUT = new URL("./results/", import.meta.url).pathname
await mkdir(OUT, { recursive: true })
const results = { checks: {}, traffic: {}, latency: {} }
const check = (name, ok, detail) => {
  results.checks[name] = { ok, detail }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` · ${detail}` : ""}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const get = (p) => fetch(APP + p).then((r) => r.json())
const setLatency = (ms) => fetch(`${APP}/config?latency=${ms}`)

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium",
  args: process.env.AUTOPLAY ? ["--autoplay-policy=no-user-gesture-required"] : [],
})
const VIEW = { width: 1130, height: 960 }

async function openHost(path = "/lab", extra = "") {
  const page = await browser.newPage({ viewport: VIEW })
  await page.goto(`${APP}/host.html?path=${path}${extra}`)
  await page.waitForTimeout(1200)
  return { page, doc: page.frameLocator("#frame") }
}
async function openWatcher(name, ctxOptions, query = "") {
  const ctx = await browser.newContext({ viewport: VIEW, ...ctxOptions })
  const page = await ctx.newPage()
  page.on("crash", () => console.log(`CRASH ${name}`))
  page.on("close", () => console.log(`CLOSED ${name}`))
  page.on("pageerror", (e) => console.log(`pageerror ${name}: ${e.message}`))
  await page.goto(`${APP}/watcher.html?name=${name}${query}`)
  await page.waitForFunction(() => window.__mirror?.replayer)
  await page.waitForTimeout(800)
  return { page, ctx, doc: page.frameLocator("#mirror iframe") }
}
const text = (loc) => loc.textContent()
const liveFrame = (host) => host.page.frames().find((f) => f.url().startsWith("http://127.0.0.1:4101"))
const hostScroll = (host) => liveFrame(host).evaluate(() => scrollY)

// ---- 1. Forwarding: Avery drives the live copy from her mirror ------------

await setLatency(0)
const host = await openHost("/lab")
const avery = await openWatcher("Avery")
const sam = await openWatcher("Sam")

const pulse = await sam.page.evaluate(() => {
  const el = window.__mirror.replayer.iframe.contentDocument.querySelector("[data-lab=pulse]")
  return el.getAnimations().map((a) => a.playState).join(",") || "none"
})
check("CSS animation runs on the mirror", pulse === "running", `play state: ${pulse}`)

await avery.page.click("#drive")
await sleep(300)
check("driver switches to Avery", (await host.page.evaluate(() => window.__mirror.room().driver)) === "Avery")

await avery.doc.locator("[data-lab=counter]").click()
await sleep(300)
check("click forwarded (button)", /Clicked 1 /.test(await text(host.doc.locator("[data-lab=counter]"))), await text(avery.doc.locator("[data-lab=counter]")))

await avery.doc.locator("[data-lab=name]").pressSequentially("Avery Chen", { delay: 40 })
await sleep(400)
check("typing forwarded", (await host.doc.locator("[data-lab=name]").inputValue()) === "Avery Chen", await text(host.doc.locator("[data-lab=echo]")))

await avery.doc.locator("[data-lab=plan]").selectOption("scale")
await avery.doc.locator("[data-lab=agree]").click()
await sleep(400)
const echo = await text(host.doc.locator("[data-lab=echo]"))
check("select forwarded", echo.includes("scale"), echo)
check("checkbox forwarded", echo.includes("· agreed"), echo)
check("mirror shows host checkbox state", await avery.doc.locator("[data-lab=agree]").isChecked())

// Dragging a range thumb hangs headless Chromium when the frame is sandboxed
// without scripts, which is how rrweb builds the mirror (dbg: a bare
// <iframe sandbox="allow-same-origin"><input type=range> hangs the same way).
// So the slider is moved with the keyboard here.
await avery.doc.locator("[data-lab=seats]").focus()
for (let i = 0; i < 10; i++) await avery.doc.locator("[data-lab=seats]").press("ArrowRight")
await sleep(400)
check("range (keyboard) forwarded", /\b15 seats/.test(await text(host.doc.locator("[data-lab=echo]"))), await text(host.doc.locator("[data-lab=echo]")))

await avery.doc.locator("[data-lab=details] summary").click()
await sleep(300)
check("<details> opened by forwarded click", await host.doc.locator("[data-lab=details]").evaluate((d) => d.open))

await avery.doc.locator("[data-lab=open-modal]").click()
await sleep(300)
const modalOnHost = await host.doc.locator("[data-lab=modal]").count()
const modalOnMirror = await avery.doc.locator("[data-lab=modal]").count()
check("React modal opens (portal)", modalOnHost === 1 && modalOnMirror === 1)
await avery.page.screenshot({ path: `${OUT}modal.watcher.png` })
await avery.doc.locator("body").press("Escape")
await sleep(300)
check("Escape forwarded closes React modal", (await host.doc.locator("[data-lab=modal]").count()) === 0, `host saw key: ${await text(host.doc.locator("[data-lab=lastkey]"))}`)

await avery.doc.locator("[data-lab=open-dialog]").click()
await sleep(300)
const dialogHost = await host.doc.locator("[data-lab=dialog]").evaluate((d) => ({ open: d.open, modal: d.matches(":modal") }))
const dialogMirror = await avery.doc.locator("[data-lab=dialog]").evaluate((d) => ({ open: d.open, modal: d.matches(":modal") }))
check("native <dialog> shows on mirror", dialogMirror.open, `host ${JSON.stringify(dialogHost)} mirror ${JSON.stringify(dialogMirror)}`)
await host.page.screenshot({ path: `${OUT}dialog.host.png` })
await avery.page.screenshot({ path: `${OUT}dialog.watcher.png` })
await avery.page.keyboard.press("Escape")
await sleep(400)
const hostDialog = await host.doc.locator("[data-lab=dialog]").evaluate((d) => d.open)
const mirrorDialog = await avery.doc.locator("[data-lab=dialog]").evaluate((d) => d.open)
check("Escape closes native <dialog> on host and mirror", !hostDialog && !mirrorDialog, `host open: ${hostDialog}, mirror open: ${mirrorDialog}`)

const hover = avery.doc.locator("[data-lab=hover]")
await hover.hover()
await sleep(400)
check("CSS :hover shows on driver's own mirror", await avery.doc.locator(".lab-tip").isVisible())
check("CSS :hover reaches the host (synthetic mouse events)", await host.doc.locator(".lab-tip").isVisible())
check("CSS :hover reaches other watchers", await sam.doc.locator(".lab-tip").isVisible())
await avery.page.mouse.move(5, 5)

const box = avery.doc.locator("[data-lab=scroll]")
await box.hover()
await avery.page.mouse.wheel(0, 300)
await sleep(500)
const innerHost = await host.doc.locator("[data-lab=scroll]").evaluate((e) => e.scrollTop)
const innerSam = await sam.doc.locator("[data-lab=scroll]").evaluate((e) => e.scrollTop)
check("inner scroll forwarded and mirrored", innerHost > 100 && Math.abs(innerSam - innerHost) < 2, `host ${innerHost}px, Sam ${innerSam}px`)

await avery.doc.locator("h1").hover()
await avery.page.mouse.wheel(0, 700)
await sleep(700)
const pageHost = await hostScroll(host)
const pageSam = await sam.page.evaluate(() => window.__mirror.replayer.iframe.contentWindow.scrollY)
check("page scroll forwarded and mirrored", pageHost > 300 && Math.abs(pageSam - pageHost) < 2, `host ${pageHost}px, Sam ${pageSam}px`)

// Sam isn't driving: his overlay blocks the mirror, and if he sends input
// anyway (a stale or hostile client), the host drops it.
await sam.page.mouse.click(300, 400)
const samSocket = await sam.page.evaluateHandle(() => new WebSocket(`ws://${location.host}/relay`))
await sam.page.evaluate(async (s) => {
  await new Promise((r) => (s.readyState === 1 ? r() : s.addEventListener("open", r)))
  s.send(JSON.stringify({ t: "hello", role: "probe", name: "Sam" }))
  s.send(JSON.stringify({ t: "input", input: { kind: "key", key: "x", code: "KeyX", from: "Sam", seq: 999 } }))
}, samSocket)
await sleep(400)
check("non-driver input dropped by host", (await text(host.doc.locator("[data-lab=lastkey]"))) !== "x", `host last key: ${await text(host.doc.locator("[data-lab=lastkey]"))}`)

// Navigation inside the prototype, then a pricing toggle.
await avery.doc.locator("nav >> text=Pricing").click()
await sleep(700)
check("link click navigates host (SPA route)", (await liveFrame(host).evaluate(() => location.pathname)) === "/pricing")
await avery.doc.locator("button:has-text('Annual')").click()
await sleep(400)
check("pricing toggle forwarded, mirrored to Sam", (await text(sam.doc.locator(".plan.featured .price"))).startsWith("$39"), await text(sam.doc.locator(".plan.featured .price")))

// ---- 2. Round trip: click on the mirror until the mirror shows the result --

async function roundTrip(latency, n = 6) {
  await setLatency(latency)
  await avery.doc.locator("button:has-text('Monthly')").click()
  await sleep(300 + latency * 4)
  const times = []
  for (let i = 0; i < n; i++) {
    const want = i % 2 === 0 ? "$39" : "$49"
    const label = i % 2 === 0 ? "Annual" : "Monthly"
    const wait = avery.page.evaluate((want) => new Promise((res) => {
      const d = window.__mirror.replayer.iframe.contentDocument
      const t0 = performance.now()
      const tick = () => (d.querySelector(".plan.featured .price")?.textContent.startsWith(want) ? res(performance.now() - t0) : requestAnimationFrame(tick))
      tick()
    }), want)
    await avery.doc.locator(`button:has-text('${label}')`).click()
    times.push(Math.round(await wait))
    await sleep(200)
  }
  times.sort((a, b) => a - b)
  return { oneWayLatencyMs: latency, samplesMs: times, medianMs: times[Math.floor(times.length / 2)] }
}
for (const l of [0, 40, 100]) {
  results.latency[`one-way ${l}ms`] = await roundTrip(l)
  console.log(`round trip at ${l}ms one-way: median ${results.latency[`one-way ${l}ms`].medianMs}ms`)
}

// Typing under latency: the host's echo of an older value can land while the
// driver has already typed more.
await avery.doc.locator("nav >> text=Lab").click()
await sleep(800)
await setLatency(100)
const phrase = "The quick brown fox jumps over the lazy dog"
await avery.doc.locator("[data-lab=name]").fill("")
await sleep(600)
await avery.doc.locator("[data-lab=name]").pressSequentially(phrase, { delay: 35 })
await sleep(1200)
const typedHost = await host.doc.locator("[data-lab=name]").inputValue()
const typedMirror = await avery.doc.locator("[data-lab=name]").inputValue()
check("fast typing at 100ms latency survives echo", typedHost === phrase && typedMirror === phrase, `host "${typedHost}" · mirror "${typedMirror}"`)
await setLatency(0)

// ---- 4. Fidelity screenshots: local watcher vs a remote one ---------------

await liveFrame(host).evaluate(() => scrollTo(0, 0))
await sleep(300)
for (const [name, y] of [["top", 0], ["media", 560]]) {
  await liveFrame(host).evaluate((y) => scrollTo(0, y), y)
  await sleep(900)
  await host.page.screenshot({ path: `${OUT}lab-${name}.host.png` })
  await sam.page.screenshot({ path: `${OUT}lab-${name}.watcher.png` })
}
// A viewer of a Mac-hosted room can't reach the owner's 127.0.0.1: every
// asset URL in the snapshot (fonts, images, video) is unreachable to them.
const remote = await openWatcher("Remote", {})
await remote.ctx.route("http://127.0.0.1:4101/**", (r) => r.abort())
await remote.page.reload()
await remote.page.waitForFunction(() => window.__mirror?.replayer)
await sleep(1500)
await remote.page.screenshot({ path: `${OUT}lab-media.remote.png` })
await liveFrame(host).evaluate(() => scrollTo(0, 0))
await sleep(800)
await remote.page.screenshot({ path: `${OUT}lab-top.remote.png` })

const pixels = async (w, sel) => w.page.evaluate((sel) => {
  const c = window.__mirror.replayer.iframe.contentDocument.querySelector(sel)
  if (!c) return "missing"
  const probe = document.createElement("canvas")
  probe.width = c.width
  probe.height = c.height
  try {
    probe.getContext("2d").drawImage(c, 0, 0)
    const d = probe.getContext("2d").getImageData(0, 0, c.width, c.height).data
    let lit = 0
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) lit++
    return lit
  } catch (e) {
    return String(e)
  }
}, sel)
const scripted = await openWatcher("Scripted", {}, "&replayCanvas=1")
await sleep(1500)
results.checks.canvasPixels = {
  "canvas2d, default mirror": await pixels(sam, "[data-lab=canvas2d]"),
  "webgl, default mirror": await pixels(sam, "[data-lab=webgl]"),
  "canvas2d, mirror allowed to run scripts": await pixels(scripted, "[data-lab=canvas2d]"),
  "webgl, mirror allowed to run scripts": await pixels(scripted, "[data-lab=webgl]"),
}
console.log("mirror canvas lit pixels", results.checks.canvasPixels)
await scripted.page.screenshot({ path: `${OUT}lab-media.scripted.png` })

// With scripts allowed in the mirror, does dragging a range thumb work?
await scripted.page.click("#drive")
await sleep(300)
await scripted.doc.locator("[data-lab=seats]").scrollIntoViewIfNeeded()
await sleep(500)
const rb = await scripted.doc.locator("[data-lab=seats]").boundingBox()
const dragged = await Promise.race([
  (async () => {
    await scripted.page.mouse.move(rb.x + 5, rb.y + rb.height / 2)
    await scripted.page.mouse.down()
    await scripted.page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 6 })
    await scripted.page.mouse.up()
    return "done"
  })(),
  sleep(8000).then(() => "hung"),
])
await sleep(500)
check("range drag works when the mirror may run scripts", dragged === "done" && /\b1[01] seats/.test(await text(host.doc.locator("[data-lab=echo]"))), `${dragged}; ${await text(host.doc.locator("[data-lab=echo]"))}`)
await avery.page.click("#drive")
await sleep(300)
const video = await sam.page.evaluate(() => {
  const v = window.__mirror.replayer.iframe.contentDocument.querySelector("[data-lab=video]")
  return v ? { src: v.currentSrc || v.getAttribute("src"), paused: v.paused, readyState: v.readyState } : null
})
check("video element present on mirror", Boolean(video), JSON.stringify(video))
const xo = await sam.page.evaluate(() => {
  const f = window.__mirror.replayer.iframe.contentDocument.querySelector("[data-lab=xo]")
  return f ? { src: f.getAttribute("src"), bodyText: f.contentDocument?.body?.innerText ?? null } : null
})
check("cross-origin iframe content mirrored", Boolean(xo?.bodyText), JSON.stringify(xo))
await remote.ctx.close()

// ---- 5. Traffic ------------------------------------------------------------

async function traffic(label, path, extra, seconds, during) {
  const h = await openHost(path, extra)
  await fetch(`${APP}/stats/reset`)
  await h.page.reload()
  await h.page.waitForTimeout(1500)
  const load = await get("/stats")
  await fetch(`${APP}/stats/reset`)
  await fetch(`${APP}/snapshot`)
  await sleep(500)
  const snap = await get("/stats")
  await fetch(`${APP}/stats/reset`)
  if (during) await during(h)
  else await sleep(seconds * 1000)
  const s = await get("/stats")
  results.traffic[label] = {
    snapshotBytes: snap.byCategory["full-snapshot"]?.bytes ?? 0,
    snapshotGzipBytes: snap.upGzipBytes,
    firstSecondsBytes: load.upBytes,
    steadyBytesPerSecond: Math.round(s.upBytes / s.seconds),
    steadyGzipBytesPerSecond: Math.round(s.upGzipBytes / s.seconds),
    messagesPerSecond: Math.round(s.upMessages / s.seconds),
    byCategory: Object.fromEntries(Object.entries(s.byCategory).map(([k, v]) => [k, Math.round(v.bytes / s.seconds)])),
  }
  console.log(label, JSON.stringify(results.traffic[label]))
  await h.page.close()
}
await host.page.close()
await traffic("Home, idle", "/", "", 10)
await traffic("Pricing, idle", "/pricing", "", 10)
await traffic("Lab, canvas off", "/lab", "&canvasFps=0", 10)
await traffic("Lab, canvas 4fps", "/lab", "&canvasFps=4", 10)
await traffic("Lab, canvas 15fps", "/lab", "&canvasFps=15", 10)
await traffic("Pricing, driver scrolls and moves the mouse", "/pricing", "", 0, async () => {
  await sleep(500)
  for (let i = 0; i < 20; i++) {
    await avery.page.mouse.move(200 + i * 30, 300 + (i % 5) * 40, { steps: 5 })
    await avery.page.mouse.wheel(0, i < 10 ? 120 : -120)
    await sleep(200)
  }
})

await writeFile(`${OUT}results.json`, JSON.stringify(results, null, 2))
await browser.close()
