import { createFluid } from "../../homepage/components/marketing/site/fluid"

/**
 * The launch screen's spinner: the homepage hero's liquid dither, stirred on
 * its own. The window opens on still water; an unseen stirrer winds up over
 * EASE ms and then circles, and the only thing drawn is where the water it
 * moves bends the light: grain where the stirred surface focuses it, shaded
 * through the hero's 8×8 Bayer thresholds at the hero's grain size. The
 * stirrer chases its circle the way the hero's peek chases the pointer, and
 * the circle leans toward the cursor.
 *
 * Built into dist/launch by scripts/build-launch.mjs.
 */

// The stage, in CSS px; the water fades to clear before its edge.
const BOX = 560
// The fluid's cell size, in CSS px.
const G = 4
// The stirrer's circle: its radius, and how long a turn takes once wound up.
const ORBIT = 64
const PERIOD = 1300
// How long the stirrer takes to wind up from rest.
const EASE = 1500
// The reach of the stirrer's push, in cells, and how hard it pushes per cell
// moved (the hero's 1.6).
const REACH = 6
const PUSH = 1.6
// The hero's water is never stirred in circles for long; kept circling it
// spins up into a whirlpool. A little extra damping and a faster pull back
// to rest keep it a spinner.
const DAMP = 0.92
const RELAX = 0.05
// How far the circle leans toward the cursor, at most, in CSS px.
const LEAN = 46
// The focus levels the bright lines trace, and their width as a share of
// each level.
const LINES = [0.5, 1.3]
const LINE_WIDTH = 0.1
// The lines are drawn half filled over an even ramp of the focus, so most of
// the stirred water sits between clear and solid and the crosshatch shows.
const LINE_FILL = 0.55
const RAMP = 0.7
const RAMP_SCALE = 1.4
const RAMP_FLOOR = 0.1
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
// How much the carried surface bunches up at each node, |det J - 1| of the
// map from where the water started to where it is: where refraction
// focuses light. Kept for this step and the last, to blend between.
let focus = new Float32Array(gw * gw)
let lastFocus = new Float32Array(gw * gw)

let ink = [0, 0, 0]
function readInk() {
  const probe = document.createElement("canvas").getContext("2d")!
  probe.fillStyle = getComputedStyle(document.body).color
  probe.fillRect(0, 0, 1, 1)
  ink = [...probe.getImageData(0, 0, 1, 1).data.slice(0, 3)]
}
readInk()
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  readInk()
  draw(1)
})

// The stirrer's speed follows a smoothstep up over EASE, so its angle is
// that curve's integral, and its push grows the same way.
function wound(t: number) {
  if (t >= EASE) return t - EASE / 2
  const u = t / EASE
  return EASE * (u * u * u - (u * u * u * u) / 2)
}
const angle = (t: number) => (wound(t) / PERIOD) * Math.PI * 2 - Math.PI / 2
const strength = (t: number) => smooth(t / EASE)

// The cursor, in the stage's CSS px, and the circle's centre, which eases
// toward it.
const cursor = { x: 0, y: 0, on: false }
addEventListener("pointermove", (e) => {
  const r = stage.getBoundingClientRect()
  cursor.x = e.clientX - r.left
  cursor.y = e.clientY - r.top
  cursor.on = true
})
document.documentElement.addEventListener("pointerleave", () => {
  cursor.on = false
})
const hub = { x: BOX / 2, y: BOX / 2 }
// Where the stirrer is: it chases its point on the circle as the hero's peek
// chases the pointer. Easing pulls it inside the circle, so it aims at a
// circle that much wider and lands on ORBIT.
const stirrer = { x: 0, y: 0, placed: false }
const AIM = 0.3
const WIDEN = 0.85

function stir(t: number) {
  fluid.keep()
  let tx = BOX / 2
  let ty = BOX / 2
  if (cursor.on) {
    const dx = cursor.x - tx
    const dy = cursor.y - ty
    const d = Math.hypot(dx, dy) || 1
    const lean = LEAN * (1 - Math.exp(-d / 300))
    tx += (dx / d) * lean
    ty += (dy / d) * lean
  }
  hub.x += (tx - hub.x) * 0.08
  hub.y += (ty - hub.y) * 0.08

  const a = angle(t)
  const ax = hub.x + (Math.cos(a) * ORBIT) / WIDEN
  const ay = hub.y + (Math.sin(a) * ORBIT) / WIDEN
  if (!stirrer.placed) Object.assign(stirrer, { x: ax, y: ay, placed: true })
  const px = stirrer.x
  const py = stirrer.y
  stirrer.x += (ax - px) * AIM
  stirrer.y += (ay - py) * AIM
  // Push along the path moved since the last step, as the hero does, so the
  // wake is unbroken. A trace of dye keeps the solver awake; it isn't drawn.
  const dx = (stirrer.x - px) / G
  const dy = (stirrer.y - py) / G
  const f = strength(t) * PUSH
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 1.5))
  for (let n = 1; n <= steps; n++) {
    fluid.splat(
      px / G + (dx * n) / steps,
      py / G + (dy * n) / steps,
      (dx * f) / steps,
      (dy * f) / steps,
      REACH,
      0.001 / steps
    )
  }
  fluid.step()

  const { vx, vy, mx, my } = fluid
  for (let r = 0, i = 0; r < gw; r++) {
    for (let c = 0; c < gw; c++, i++) {
      vx[i]! *= DAMP
      vy[i]! *= DAMP
      mx[i]! += (c - mx[i]!) * RELAX
      my[i]! += (r - my[i]!) * RELAX
    }
  }
  const spare = lastFocus
  lastFocus = focus
  focus = spare
  for (let r = 1; r < gw - 1; r++) {
    for (let c = 1, i = r * gw + 1; c < gw - 1; c++, i++) {
      const a = (mx[i + 1]! - mx[i - 1]!) / 2
      const b = (mx[i + gw]! - mx[i - gw]!) / 2
      const d = (my[i + 1]! - my[i - 1]!) / 2
      const e = (my[i + gw]! - my[i - gw]!) / 2
      focus[i] = Math.abs(a * e - b * d - 1)
    }
  }
}

function at(field: Float32Array, j: number, fx: number, fy: number) {
  const top = field[j]! + (field[j + 1]! - field[j]!) * fx
  const bot = field[j + gw]! + (field[j + gw + 1]! - field[j + gw]!) * fx
  return top + (bot - top) * fy
}

// `blend` is how far between the last step and this one the frame falls.
function draw(blend: number) {
  const data = img.data
  const [ir, ig, ib] = ink
  const edge = BOX / 2 - 4
  for (let r = 0, i = 0; r < cols; r++) {
    const py = r * cell + cell / 2
    const gy = py / G
    const y0 = gy | 0
    const fy = gy - y0
    for (let c = 0; c < cols; c++, i++) {
      const o = i * 4
      const px = c * cell + cell / 2
      const gx = px / G
      const x0 = gx | 0
      const j = y0 * gw + x0
      // Still water: nothing to draw.
      if (
        focus[j]! < 0.05 &&
        lastFocus[j]! < 0.05 &&
        focus[j + 1]! < 0.05 &&
        focus[j + gw]! < 0.05 &&
        focus[j + gw + 1]! < 0.05
      ) {
        data[o + 3] = 0
        continue
      }
      const fx = gx - x0
      const f =
        at(lastFocus, j, fx, fy) * (1 - blend) + at(focus, j, fx, fy) * blend
      let line = 0
      for (const level of LINES) {
        const z = (f - level) / (level * LINE_WIDTH)
        line = Math.max(line, Math.exp(-z * z))
      }
      let k = Math.max(
        line * LINE_FILL,
        RAMP * (1 - Math.exp(-Math.max(f - RAMP_FLOOR, 0) / RAMP_SCALE))
      )
      // Fade to clear before the stage's edge.
      const rim = 1 - Math.hypot(px - BOX / 2, py - BOX / 2) / edge
      k *= rim <= 0 ? 0 : Math.min(rim * 2.5, 1)
      data[o] = ir!
      data[o + 1] = ig!
      data[o + 2] = ib!
      data[o + 3] = smooth(k) > BAYER[(r & 7) * 8 + (c & 7)]! ? 255 : 0
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
  draw(into / STEP)
}

if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
  // One still frame of the spinner, wound up.
  for (let t = 0; t < EASE + PERIOD; t += STEP) advance(STEP)
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
