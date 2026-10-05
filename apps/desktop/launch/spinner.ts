import { createFluid } from "../../homepage/components/marketing/site/fluid"

/**
 * The launch screen's spinner: the app's Loader2 arc drawn in the homepage
 * hero's liquid dither. A 300° ring of grain turns once a second, solid at
 * its head and dissolving through the hero's 8×8 Bayer thresholds behind it.
 * The head stirs the hero's fluid solver as it goes, and the marbling that
 * stirring carries ripples the grain along the arc.
 *
 * Built into dist/launch by scripts/build-launch.mjs.
 */

// The stage, in CSS px.
const BOX = 40
// The fluid's cell size, in CSS px.
const G = 2
// The ring's radius and half its width, in CSS px, and how long a turn takes.
const ORBIT = 12
const HALF_WIDTH = 4
const PERIOD = 1000
// How much of the turn the arc covers, from its head back (Loader2's 300°).
const ARC = 300 / 360
// How hard the head stirs the water, and how far its push reaches, in cells.
const PUSH = 1.4
const REACH = 2.4
// How much the marbling lightens and darkens the grain along the arc.
const RIPPLE = 0.3
// The fluid steps every 40ms whatever the frame rate, as on the homepage.
const STEP = 40

const stage = document.querySelector<HTMLElement>(".stage")!
const canvas = stage.querySelector("canvas")!
const ctx = canvas.getContext("2d")!

const BAYER = new Float32Array(64)
for (let y = 0; y < 8; y++) {
  for (let x = 0; x < 8; x++) {
    let v = 0
    for (let bit = 1; bit <= 4; bit <<= 1) {
      const qx = x & bit ? 1 : 0
      const qy = y & bit ? 1 : 0
      v = v * 4 + [0, 2, 3, 1][qy * 2 + qx]!
    }
    BAYER[y * 8 + x] = (v + 0.5) / 64
  }
}
const smooth = (k: number) => {
  const c = k < 0 ? 0 : k > 1 ? 1 : k
  return c * c * (3 - 2 * c)
}

// Value noise for the marbled bands, as the hero veil draws them.
const perm = new Uint8Array(512)
{
  let s = 7
  const a = [...Array(256).keys()]
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  for (let i = 0; i < 512; i++) perm[i] = a[i & 255]!
}
const hash = (x: number, y: number) => perm[(perm[x & 255]! + y) & 255]! / 255
function noise(x: number, y: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = smooth(x - xi)
  const v = smooth(y - yi)
  const a = hash(xi, yi)
  const b = hash(xi + 1, yi)
  const c = hash(xi, yi + 1)
  const d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

// One grain per 3 device pixels on retina screens, 2 elsewhere, as the hero.
const cell = Math.min(window.devicePixelRatio || 1, 2) >= 2 ? 1.5 : 2
const cols = Math.round(BOX / cell)
const size = `${cols * cell}px`
stage.style.width = stage.style.height = size
canvas.width = canvas.height = cols
canvas.style.width = canvas.style.height = size
const img = ctx.createImageData(cols, cols)

const gw = Math.ceil(BOX / G) + 2
const fluid = createFluid(gw, gw)

let ink = [0, 0, 0]
function readInk() {
  const probe = document.createElement("canvas").getContext("2d")!
  probe.fillStyle = getComputedStyle(document.body).color
  probe.fillRect(0, 0, 1, 1)
  ink = [...probe.getImageData(0, 0, 1, 1).data.slice(0, 3)]
}
readInk()

const angle = (t: number) => (t / PERIOD) * Math.PI * 2 - Math.PI / 2

// The head pushes the water along the ring as it turns, in a few splats per
// step so its wake is unbroken. A trace of dye keeps the solver awake.
function stir(t: number) {
  fluid.keep()
  const from = angle(t - STEP)
  const to = angle(t)
  const splats = 3
  for (let n = 1; n <= splats; n++) {
    const a = from + ((to - from) * n) / splats
    fluid.splat(
      (BOX / 2 + Math.cos(a) * ORBIT) / G,
      (BOX / 2 + Math.sin(a) * ORBIT) / G,
      (-Math.sin(a) * PUSH) / splats,
      (Math.cos(a) * PUSH) / splats,
      REACH,
      0.001 / splats
    )
  }
  fluid.step()
}

function at(field: Float32Array, j: number, fx: number, fy: number) {
  const top = field[j]! + (field[j + 1]! - field[j]!) * fx
  const bot = field[j + gw]! + (field[j + gw + 1]! - field[j + gw]!) * fx
  return top + (bot - top) * fy
}

// `blend` is how far between the last step and this one the frame falls.
function draw(t: number, blend: number) {
  const { mx, my, prevMx, prevMy } = fluid
  const data = img.data
  const [ir, ig, ib] = ink
  const head = angle(t)
  const s = t / 1000
  for (let r = 0, i = 0; r < cols; r++) {
    const py = r * cell + cell / 2
    const dy = py - BOX / 2
    for (let c = 0; c < cols; c++, i++) {
      const o = i * 4
      const px = c * cell + cell / 2
      const dx = px - BOX / 2
      // Across the ring: solid along its middle, thinning to clear at its
      // edges. Along it: solid at the head, thinning to clear at the tail.
      const across = 1 - Math.abs(Math.hypot(dx, dy) - ORBIT) / HALF_WIDTH
      let behind = (head - Math.atan2(dy, dx)) % (Math.PI * 2)
      if (behind < 0) behind += Math.PI * 2
      const along = 1 - behind / (Math.PI * 2 * ARC)
      if (across <= 0 || along <= 0) {
        data[o + 3] = 0
        continue
      }
      const gx = px / G
      const gy = py / G
      const x0 = gx | 0
      const y0 = gy | 0
      const j = y0 * gw + x0
      const fx = gx - x0
      const fy = gy - y0
      const ux = at(prevMx, j, fx, fy) * (1 - blend) + at(mx, j, fx, fy) * blend
      const uy = at(prevMy, j, fx, fy) * (1 - blend) + at(my, j, fx, fy) * blend
      const band = Math.sin(
        noise(ux * G * 0.05 + s * 0.35, uy * G * 0.05 - s * 0.28) * 16 + s * 1.6
      )
      // The arc's shade falls off evenly from head to tail, so every Bayer
      // level along the way shows as its own crosshatch.
      const k =
        Math.min(across * 2.5, 1) *
        Math.min(along * 1.25, 1) *
        (1 + RIPPLE * band)
      data[o] = ir!
      data[o + 1] = ig!
      data[o + 2] = ib!
      data[o + 3] = k > BAYER[(r & 7) * 8 + (c & 7)]! ? 255 : 0
    }
  }
  ctx.putImageData(img, 0, 0)
}

let clock = 0
let into = 0
function advance(ms: number) {
  clock += ms
  // A long gap (a hidden window) catches up by a few steps, not all.
  into = Math.min(into + ms, STEP * 3)
  while (into >= STEP) {
    stir(clock - into + STEP)
    into -= STEP
  }
  draw(clock, into / STEP)
}

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  readInk()
  draw(clock, 1)
})

if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
  // One still frame of the spinner.
  for (let t = 0; t < PERIOD; t += STEP) advance(STEP)
} else {
  let last = performance.now()
  const frame = (now: number) => {
    if (document.body.classList.contains("failed")) return
    advance(now - last)
    last = now
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
