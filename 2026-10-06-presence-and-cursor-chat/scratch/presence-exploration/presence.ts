// EXPLORATION ONLY: multiplayer presence design pass. Never committed.
import type { Page } from "playwright-core"
import type { Screen } from "../screen"
import { ids, varUint } from "../helpers"

type Person = {
  id: string
  name: string
  color: string
  pointer: { x: number; y: number } | null
  selected?: string[]
  message?: string | null
}

const env = (k: string, d: string) => process.env[k] ?? d
const PAL = env("EXPLORE_PAL", "#FFB74D,#4DD0E1,#BA68C8").split(",")
const SELF = env("EXPLORE_SELF", "#64B5F6")
const VARIANT = env("EXPLORE_VARIANT", "")
const CHAT = env("EXPLORE_CHAT", "1") === "1"

const sockets: Array<{ send: (m: Buffer) => void }> = []
let clock = 0

function announce(people: Person[]): Buffer {
  clock++
  const entries = people.flatMap((p, i) => {
    const json = Buffer.from(
      JSON.stringify({
        identity: { id: p.id, name: p.name },
        pointer: p.pointer,
        viewport: { x: 0, y: 0, zoom: 1 },
        color: p.color,
        selectedIframeLayerIds: p.selected ?? [],
        message: p.message ?? null,
      })
    )
    return [...varUint(2_000_000_000 + i), ...varUint(clock), ...varUint(json.length), ...json]
  })
  const u = Buffer.from([...varUint(people.length), ...entries])
  return Buffer.concat([Buffer.from([1, ...varUint(u.length)]), u])
}

let current: Person[] = []
function send(people: Person[]) {
  current = people
  const m = announce(people)
  for (const s of sockets) s.send(m)
}

async function passthrough(page: Page) {
  sockets.length = 0
  await page.routeWebSocket(/^(?!.*\/_next\/)/, (ws) => {
    const server = ws.connectToServer()
    ws.onMessage((m) => server.send(m))
    server.onMessage((m) => ws.send(m))
    sockets.push({ send: (m) => ws.send(m) })
  })
  await page.addInitScript(
    `try{localStorage.setItem("explorePresence",${JSON.stringify(VARIANT)});localStorage.setItem("explorePresenceSelf",${JSON.stringify(SELF)})}catch(e){}`
  )
}

async function rect(page: Page, sel: string) {
  const b = await page.locator(sel).first().boundingBox({ timeout: 20_000 })
  if (!b) throw new Error("no box " + sel)
  return b
}

async function stage(page: Page) {
  const R = await rect(page, '[data-layer-id="layer-checkout-desktop"]')
  const M = await rect(page, '[data-layer-id="layer-checkout-mobile"]')
  const zoom = R.width / 1280
  // Probe: a peer at canvas (0,0) tells us where canvas (0,0) is on screen.
  send([{ id: "probe", name: "Probe", color: "#000", pointer: { x: 0, y: 0 } }])
  await page.waitForTimeout(400)
  const probe = await page.evaluate(() => {
    const el = [...document.querySelectorAll("svg path")].find((p) =>
      p.getAttribute("d")?.startsWith("M0.928711")
    )
    const r = el?.closest("svg")?.getBoundingClientRect()
    return r ? { x: r.left, y: r.top } : null
  })
  if (!probe) throw new Error("probe cursor not drawn")
  const c = (sx: number, sy: number) => ({ x: (sx - probe.x) / zoom, y: (sy - probe.y) / zoom })
  send([
    { id: "u-ana", name: "Ana Ruiz", color: PAL[0]!, pointer: c(R.x + R.width * 0.52, R.y + R.height * 0.3) },
    { id: "u-ben", name: "Ben Okafor", color: PAL[1]!, pointer: c(M.x + M.width * 0.55, M.y + M.height * 0.45), selected: ["layer-checkout-mobile"] },
    {
      id: "u-cleo",
      name: "Cleo Park",
      color: PAL[2]!,
      pointer: c(R.x + R.width * 0.16, R.y + R.height * 0.62),
      message: CHAT ? "Can we try the summary column a bit wider?" : null,
    },
  ])
  await page.waitForTimeout(300)
  if (CHAT) {
    const o = c(R.x + R.width * 0.56, R.y + R.height + 22)
    await page.evaluate(([x, y, color]) => window.dispatchEvent(new CustomEvent("explore-chat", { detail: { x, y, color, value: "Looks good, ship it" } })), [o.x, o.y, SELF] as const)
  }
  await page.mouse.move(5, 500)
  await page.getByRole("button", { name: /\(you\)/ }).first().waitFor({ timeout: 15_000 }).catch(() => console.log("no self avatar"))
  await page.waitForTimeout(300)
  send(current)
}

const screens: Screen[] = [
  {
    name: "presence",
    description: "Three peers on the checkout canvas, one chatting, plus your own cursor chat.",
    hosted: true,
    path: `/${ids.rooms.checkout}`,
    beforeNavigate: passthrough,
    prepare: stage,
    settleMs: 300,
  },
]
export default screens
