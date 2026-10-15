// EXPLORATION ONLY (host badge, #1932): never committed.
// Two peers on the Checkout canvas (the host and another viewer), seen by a
// viewer. EXPLORE_OPT picks the injected option: today | a | b | c | d.
// EXPLORE_HOST_AWAY=1 takes the host's pointer off the canvas (in the chat panel).
// EXPLORE_DUMP=<file> writes element boxes as JSON for measuring and cropping.
import { writeFileSync } from "node:fs"
import type { Page } from "playwright-core"
import type { Screen } from "../screen"
import { ids, varUint } from "../helpers"

type Person = {
  id: string
  name: string
  color: string
  host?: boolean
  pointer: { x: number; y: number } | null
}

const OPT = process.env.EXPLORE_OPT ?? "today"
const DUMP = process.env.EXPLORE_DUMP ?? ""
const HOST_AWAY = process.env.EXPLORE_HOST_AWAY === "1"

const HOST = "Maya Chen"
const HOST_COLOR = "#FF8506"
const OTHER = "Ben Okafor"
const OTHER_COLOR = "#49A9FF"
const SELF_COLOR = "#C0F447"

const sockets: Array<(m: Buffer) => void> = []
let clock = 0
let current: Person[] = []
let keepAlive: ReturnType<typeof setInterval> | undefined

function announce(people: Person[]): Buffer {
  clock++
  const entries = people.flatMap((p, i) => {
    const json = Buffer.from(
      JSON.stringify({
        identity: { id: p.id, name: p.name },
        pointer: p.pointer,
        viewport: { x: 0, y: 0, zoom: 1 },
        color: p.color,
        selectedIframeLayerIds: [],
        // What the server would stamp (#1932): trusted, not self-reported.
        host: p.host ?? false,
      })
    )
    return [...varUint(2_000_000_000 + i), ...varUint(clock), ...varUint(json.length), ...json]
  })
  const u = Buffer.from([...varUint(people.length), ...entries])
  return Buffer.concat([Buffer.from([1, ...varUint(u.length)]), u])
}

function send(people: Person[]) {
  current = people
  const m = announce(people)
  for (const s of sockets) s(m)
}

async function passthrough(page: Page) {
  sockets.length = 0
  await page.routeWebSocket(/^(?!.*\/_next\/)/, (ws) => {
    const server = ws.connectToServer()
    ws.onMessage((m) => server.send(m))
    server.onMessage((m) => ws.send(m))
    sockets.push((m) => ws.send(m))
  })
  // Keep the peers alive past awareness's 30s timeout, without holding the run open.
  if (!keepAlive) {
    keepAlive = setInterval(() => current.length && send(current), 8_000)
    keepAlive.unref()
  }
}

async function rect(page: Page, sel: string) {
  const b = await page.locator(sel).first().boundingBox({ timeout: 20_000 })
  if (!b) throw new Error("no box " + sel)
  return b
}

// Phosphor HouseSimple, Bold (tiny state glyphs use Bold).
const HOUSE =
  '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M222.14,105.85l-80-80a20,20,0,0,0-28.28,0l-80,80A19.86,19.86,0,0,0,28,120v96a12,12,0,0,0,12,12H216a12,12,0,0,0,12-12V120A19.86,19.86,0,0,0,222.14,105.85ZM204,204H52V121.65l76-76,76,76Z"/></svg>'

// Shared: the stock AvatarBadge look (primary fill, background ring) at 14px, a house glyph inside.
const CSS_BADGE = `
.explore-badge { position: absolute; right: -4px; bottom: -4px; z-index: 10; display: flex; width: 14px; height: 14px; border-radius: 9999px; align-items: center; justify-content: center; background: var(--primary); color: var(--primary-foreground); box-shadow: 0 0 0 2px var(--explore-ring, var(--background)); }
.explore-badge svg { width: 8px; height: 8px; }
.explore-tip { position: fixed; z-index: 99999; pointer-events: none; }
.explore-tip > i { position: absolute; width: 10px; height: 10px; background: inherit; border-radius: 2px; transform: rotate(45deg); }
.explore-tip[data-side="bottom"] > i { top: -4px; left: calc(50% - 5px); }
.explore-tip[data-side="right"] > i { left: -4px; top: calc(50% - 5px); }
`

// Option A: "Host" inside the host's cursor tag, after a hairline in the tag's own ink.
const CSS_A = `
[data-explore-host] > span, [data-explore-host] > div > div:first-child { display: flex !important; align-items: center; gap: 6px; }
[data-explore-host] > span::after, [data-explore-host] > div > div:first-child::after {
  content: "Host"; font-weight: 500; font-stretch: 98.8%; padding-left: 6px; border-left: 1px solid currentColor; line-height: 12px;
}`

// Option D: "Hosted by" inside the breadcrumb pill, after the canvas name and its menu.
const CSS_D = `
.explore-hosted { display: flex; align-items: center; gap: 6px; height: 24px; margin-left: 4px; padding: 0 6px 0 10px; border-left: 1px solid var(--border); font-size: 13px; line-height: 16px; color: var(--muted-foreground); white-space: nowrap; }
.explore-hosted b { font-weight: 400; color: var(--foreground); }
.explore-hosted i { position: relative; display: inline-flex; width: 20px; height: 20px; border-radius: 9999px; align-items: center; justify-content: center; font-style: normal; font-size: 12px; line-height: 16px; font-weight: 500; color: #000; background: ${HOST_COLOR}; }
`

// Tag the host's cursor (by name here; the real build reads the server's stamp).
const TAG_HOST_JS = `
(() => {
  const tag = () => {
    for (const el of document.querySelectorAll('[class*="z-(--z-canvas-presence)"]')) {
      const label = el.querySelector(':scope > span, :scope > div > div:first-child')
      if (label && label.textContent.trim().startsWith(${JSON.stringify(HOST)})) el.setAttribute('data-explore-host', '')
      else el.removeAttribute('data-explore-host')
    }
  }
  tag(); setInterval(tag, 100)
})()`

// A tooltip with the stock TooltipContent classes, placed under (or right of) an element.
const TIP_FN = `
function exploreTip(target, text, side) {
  const r = target.getBoundingClientRect()
  const tip = document.createElement('div')
  tip.className = 'explore-tip inverted inline-flex w-fit items-center gap-1.5 rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground ring-1 ring-foreground/10'
  tip.textContent = text
  tip.dataset.side = side
  const arrow = document.createElement('i')
  tip.appendChild(arrow)
  arrow.style.background = getComputedStyle(tip).backgroundColor
  document.body.appendChild(tip)
  const t = tip.getBoundingClientRect()
  if (side === 'right') {
    tip.style.left = Math.round(r.right + 8) + 'px'
    tip.style.top = Math.round(r.top + r.height / 2 - t.height / 2) + 'px'
  } else {
    tip.style.left = Math.round(r.left + r.width / 2 - t.width / 2) + 'px'
    tip.style.top = Math.round(r.bottom + 8) + 'px'
  }
}`

async function stage(page: Page) {
  const R = await rect(page, '[data-layer-id="layer-checkout-desktop"]')
  const M = await rect(page, '[data-layer-id="layer-checkout-mobile"]')
  const zoom = R.width / 1280
  // A probe peer at canvas (0,0) tells us where canvas (0,0) is on screen.
  send([{ id: "probe", name: "Probe", color: "#000", pointer: { x: 0, y: 0 } }])
  await page.waitForTimeout(500)
  const probe = (await page.evaluate(`(() => {
    const el = [...document.querySelectorAll("svg path")].find((p) => (p.getAttribute("d") || "").startsWith("M0.928711"))
    const r = el && el.closest("svg") && el.closest("svg").getBoundingClientRect()
    return r ? { x: r.left, y: r.top } : null
  })()`)) as { x: number; y: number } | null
  if (!probe) throw new Error("probe cursor not drawn")
  const c = (sx: number, sy: number) => ({ x: (sx - probe.x) / zoom, y: (sy - probe.y) / zoom })
  send([
    {
      id: "u-maya",
      name: HOST,
      color: HOST_COLOR,
      host: true,
      pointer: HOST_AWAY ? null : c(R.x + R.width * 0.5, R.y + R.height * 0.34),
    },
    { id: "u-ben", name: OTHER, color: OTHER_COLOR, pointer: c(M.x + M.width * 0.5, M.y + M.height * 0.42) },
  ])
  await page.mouse.move(5, 900)
  await page.waitForTimeout(600)

  if (OPT !== "today") await page.addStyleTag({ content: CSS_BADGE })
  if (OPT === "a") {
    await page.addStyleTag({ content: CSS_A })
    await page.evaluate(TAG_HOST_JS)
  }
  if (OPT === "b") {
    // The Pages panel's row avatars (#1840): the host's carries the badge, and
    // hovering the stack names everyone, the host marked.
    await page.evaluate(`(() => {
      ${TIP_FN}
      const stack = document.querySelector('[role="img"][aria-label*=${JSON.stringify(HOST)}]')
      if (!stack) throw new Error('no page people')
      const host = [...stack.children].find(a => a.textContent.trim() === 'M')
      host.style.position = 'relative'
      host.style.setProperty('--explore-ring', 'var(--sidebar-accent)')
      host.style.overflow = 'visible'
      const b = document.createElement('span'); b.className = 'explore-badge'; b.innerHTML = ${JSON.stringify(HOUSE)}
      host.appendChild(b)
      // The host goes last, so nothing overlaps the badge.
      stack.appendChild(host)
      stack.setAttribute('aria-label', 'Maya Chen (host), Ben Okafor')
      exploreTip(stack, 'Maya Chen (host), Ben Okafor', 'right')
    })()`)
  }
  if (OPT === "c") {
    // The hosted build's facepile (FollowingToolbar) in the top-right pill after
    // the zoom menu: 24px avatars overlapping 4px, you last; the host badged.
    await page.addStyleTag({
      content: `
.explore-faces { display: flex; align-items: center; margin-left: 2px; }
.explore-face { position: relative; display: inline-flex; border-radius: 9999px; box-shadow: 0 0 0 2px var(--background); }
.explore-face + .explore-face { margin-left: -4px; }
.explore-face:nth-child(1) { z-index: 3; } .explore-face:nth-child(2) { z-index: 2; } .explore-face:nth-child(3) { z-index: 1; }
.explore-face > .av { display: flex; width: 24px; height: 24px; border-radius: 9999px; align-items: center; justify-content: center; font-size: 12px; line-height: 16px; font-weight: 500; color: #000; }
`,
    })
    await page.evaluate(`(() => {
      ${TIP_FN}
      const zoom = [...document.querySelectorAll('button')].find(b => /%/.test(b.textContent) && b.getBoundingClientRect().top < 60)
      if (!zoom) throw new Error('no zoom menu')
      const face = (letter, color, host) => '<span class="explore-face"' + (host ? ' data-host' : '') + '><span class="av" style="background:' + color + '">' + letter + '</span>' + (host ? '<span class="explore-badge">' + ${JSON.stringify(HOUSE)} + '</span>' : '') + '</span>'
      const wrap = document.createElement('div')
      wrap.className = 'explore-faces'
      wrap.innerHTML = face('M', ${JSON.stringify(HOST_COLOR)}, true) + face('B', ${JSON.stringify(OTHER_COLOR)}, false) + face('A', ${JSON.stringify(SELF_COLOR)}, false)
      zoom.insertAdjacentElement('afterend', wrap)
      exploreTip(wrap.querySelector('[data-host]'), 'Follow Maya Chen (host)', 'bottom')
    })()`)
  }
  if (OPT === "d") {
    await page.addStyleTag({ content: CSS_D })
    await page.evaluate(`(() => {
      const name = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'Checkout flow' && e.getBoundingClientRect().top < 60)
      const pill = name && name.closest('.shadow-md')
      if (!pill) throw new Error('no breadcrumb pill')
      const chip = document.createElement('span')
      chip.className = 'explore-hosted'
      chip.innerHTML = '<i>M</i><span>Hosted by <b>Maya Chen</b></span>'
      pill.appendChild(chip)
    })()`)
  }
  await page.waitForTimeout(300)

  if (DUMP) {
    const data = await page.evaluate(`(() => {
      const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }
      const name = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'Checkout flow' && e.getBoundingClientRect().top < 60)
      const tags = [...document.querySelectorAll('[class*="z-(--z-canvas-presence)"]')].map(e => {
        const l = e.querySelector(':scope > span, :scope > div')
        return { text: e.textContent, box: box(l), font: l && getComputedStyle(l).font, bg: l && getComputedStyle(l).backgroundColor }
      })
      const stack = document.querySelector('[role="img"][aria-label*="Maya"]')
      return {
        viewport: { w: innerWidth, h: innerHeight },
        breadcrumb: box(name && name.closest('.shadow-md')),
        breadcrumbHtml: name && name.closest('.shadow-md') && name.closest('.shadow-md').outerHTML.slice(0, 3000),
        rightPill: box([...document.querySelectorAll('button')].find(b => /%/.test(b.textContent) && b.getBoundingClientRect().top < 60)?.closest('.shadow-md')),
        pageRow: box(stack && stack.closest('li')),
        pageStack: box(stack),
        pageAvatars: stack ? [...stack.children].map(a => ({ box: box(a), font: getComputedStyle(a).font })) : null,
        faces: box(document.querySelector('.explore-faces')),
        hosted: box(document.querySelector('.explore-hosted')),
        tips: [...document.querySelectorAll('.explore-tip')].map(box),
        arrow: (() => { const a = document.querySelector('.explore-tip > i'); if (!a) return 'none'; const cs = getComputedStyle(a); return { box: box(a), bg: cs.backgroundColor, pos: cs.position, disp: cs.display, html: a.parentElement.outerHTML } })(),
        tags,
      }
    })()`)
    writeFileSync(DUMP, JSON.stringify(data, null, 2))
  }
  send(current)
  await page.waitForTimeout(200)
}

const screens: Screen[] = [
  {
    name: "host-badge",
    description: "The Checkout canvas with the host and another viewer present (host badge exploration).",
    path: `/${ids.rooms.checkout}`,
    beforeNavigate: passthrough,
    prepare: stage,
    settleMs: 300,
  },
]
export default screens
