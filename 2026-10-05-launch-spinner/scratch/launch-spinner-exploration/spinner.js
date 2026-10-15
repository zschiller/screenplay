// Launch spinner prototype: the homepage hero's veil ingredients (Bayer 8x8
// grains at 1.5 CSS px, createFluid, marbled bands) driven by a stirrer that
// moves on its own instead of the pointer.
const Q = new URLSearchParams(location.search)
const OPT = Q.get("o") || "a"
if (Q.get("t")) document.documentElement.dataset.t = Q.get("t")
const MANUAL = Q.has("manual")
if (MANUAL) document.documentElement.dataset.manual = ""
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches || Q.has("still")

const perm = new Uint8Array(512)
{ let s = 7; const a = [...Array(256).keys()]
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]] }
  for (let i = 0; i < 512; i++) perm[i] = a[i & 255] }
const hash = (x, y) => perm[(perm[x & 255] + y) & 255] / 255
const noise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v }
const BAYER = new Float32Array(64)
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { let v = 0
  for (let bit = 1; bit <= 4; bit <<= 1) v = v * 4 + [0, 2, 3, 1][(y & bit ? 1 : 0) * 2 + (x & bit ? 1 : 0)]
  BAYER[y * 8 + x] = (v + 0.5) / 64 }
const ss = (k) => { k = k < 0 ? 0 : k > 1 ? 1 : k; return k * k * (3 - 2 * k) }

// Per option: box (CSS px), fluid cell (CSS px), and how the stirrer moves.
const CFG = {
  // A Orbit: one stirrer circles; its fading dye trail is the spinner.
  a: { box: 72, g: 2, period: 1100, stirrers: 1, orbit: 18, rad: 4, amt: 0.35, push: 1.3, decay: 0.935 },
  // B Ring: Loader2's arc in grain; the head stirs the marbling as it turns.
  b: { box: 40, g: 2, period: 1000, stirrers: 1, orbit: 12, rad: 2.4, amt: 0, push: 1.4 },
  // C Pool: a disc of grain kept turning by two stirrers, like the hero
  // under a slow circling cursor.
  c: { box: 136, g: 2.5, period: 2600, stirrers: 2, orbit: 26, rad: 7, amt: 0.14, push: 1.6 },
  // Round 2: no dye. The surface is the page; only the water the stirrer
  // disturbs shows, as grain drawn from how far it was carried.
  ra: { box: 96, g: 2, period: 1100, stirrers: 1, orbit: 16, rad: 3.5, amt: 0, push: 0.9, relax: 0.12, damp: 0.86 },
  rb: { box: 96, g: 2, period: 1100, stirrers: 1, orbit: 16, rad: 3.5, amt: 0, push: 0.9, relax: 0.12, damp: 0.86 },
  rc: { box: 144, g: 2, period: 2400, stirrers: 2, orbit: 28, rad: 4.5, amt: 0, push: 0.8, relax: 0.06, damp: 0.88 },
  // Round 3: A bigger and stirred harder. wob sways the stirrer in and out
  // of its circle so the line keeps breaking.
  rd: { box: 128, g: 2, period: 1100, stirrers: 1, orbit: 28, rad: 6, amt: 0, push: 1.6, relax: 0.1, damp: 0.88, wob: 0, lines: [0.35, 0.9] },
  re: { box: 144, g: 2, period: 1100, stirrers: 1, orbit: 30, rad: 7, amt: 0, push: 2.2, relax: 0.08, damp: 0.9, wob: 5, lines: [0.4, 1, 2] },
  rf: { box: 168, g: 2, period: 1200, stirrers: 1, orbit: 34, rad: 8, amt: 0, push: 3, relax: 0.07, damp: 0.91, wob: 9, lines: [0.45, 1.1, 2.2, 4] },
  // Round 4: round 3's A, plus a ripple surface under the whole window that
  // the stirrer also disturbs, so rings roll out across the page.
  wa: { ease: 1500, box: 128, g: 2, period: 1100, stirrers: 1, orbit: 28, rad: 6, amt: 0, push: 1.6, relax: 0.1, damp: 0.88, wob: 0, lines: [0.35, 0.9], wave: { damp: 0.984, amp: 1 } },
  wb: { ease: 1500, box: 128, g: 2, period: 1100, stirrers: 1, orbit: 28, rad: 6, amt: 0, push: 1.6, relax: 0.1, damp: 0.88, wob: 0, lines: [0.35, 0.9], wave: { damp: 0.997, amp: 1 } },
  wc: { ease: 1500, box: 128, g: 2, period: 1100, stirrers: 1, orbit: 28, rad: 6, amt: 0, push: 1.6, relax: 0.1, damp: 0.88, wob: 0, lines: [0.35, 0.9], wave: { damp: 0.997, amp: 1.6 }, noCore: true },
  // Round 5: no stirrer. The water in the centre bobs up and down and the
  // rings it sends out fade before they get far.
  ba: { ease: 1500, box: 128, g: 2, period: 1100, stirrers: 1, orbit: 0, rad: 1, amt: 0, push: 0, noCore: true, wave: { hz: 30, damp: 0.972, th: 0.006, gain: 40, bob: { hz: 1.4, amp: 0.25, r: 2.5 } } },
  bb: { ease: 1500, box: 128, g: 2, period: 1100, stirrers: 1, orbit: 0, rad: 1, amt: 0, push: 0, noCore: true, wave: { hz: 30, damp: 0.972, th: 0.02, gain: 30, bob: { hz: 2.2, amp: 0.25, r: 2 } } },
  bc: { ease: 1500, box: 128, g: 2, period: 1100, stirrers: 1, orbit: 0, rad: 1, amt: 0, push: 0, noCore: true, wave: { hz: 30, damp: 0.972, th: 0.02, gain: 30, bob: { hz: 2.2, amp: 0.25, r: 2, drift: 8 } } },
  // Round 6: round 3's A, eased in from still water, reacting to the cursor.
  // ca: the cursor stirs the water around the spinner. cb: the whole window
  // is water. cc: the cursor doesn't stir; the spinner leans toward it.
  ca: { ease: 1500, box: 360, g: 2, period: 1100, stirrers: 1, orbit: 28, rad: 6, amt: 0, push: 1.6, relax: 0.1, damp: 0.88, wob: 0, lines: [0.35, 0.9], cursor: 2.5 },
  cb: { ease: 1500, box: "window", g: 2, period: 1100, stirrers: 1, orbit: 28, rad: 6, amt: 0, push: 1.6, relax: 0.1, damp: 0.88, wob: 0, lines: [0.35, 0.9], cursor: 2.5, noVig: true },
  cc: { ease: 1500, box: 240, g: 2, period: 1100, stirrers: 1, orbit: 28, rad: 6, amt: 0, push: 1.6, relax: 0.1, damp: 0.88, wob: 0, lines: [0.35, 0.9], lean: 28 },
  // Round 7: C's lean, with the hero's flow: the stirrer chases its circle
  // the way the hero's peek chases the pointer, pushes by how far it moved
  // (x1.6), and the water keeps the hero's own damping and slow relaxing,
  // with no extra calming. g is the fluid's cell size: the hero's is 8px.
  la: { lw: 0.1, ease: 1500, box: 320, g: 4, period: 1100, stirrers: 1, orbit: 28, rad: 3, amt: 0, hero: 1.6, relax: 0.05, damp: 0.92, lines: [0.5, 1.3], lean: 28 },
  lb: { lw: 0.1, ease: 1500, box: 320, g: 6, period: 1100, stirrers: 1, orbit: 28, rad: 2.4, amt: 0, hero: 1.6, relax: 0.05, damp: 0.92, lines: [0.5, 1.3], lean: 28 },
  lc: { lw: 0.1, ease: 1500, box: 320, g: 4, period: 1100, stirrers: 1, orbit: 28, rad: 3, amt: 0, hero: 1.6, relax: 0.03, damp: 0.95, lines: [0.5, 1.3], lean: 28 },
  // Round 8: round 7's A at three larger sizes; the stirrer, its reach and
  // the lean scale with the circle.
  sa: { soft: [0.55, 0.7, 1.4], lw: 0.1, ease: 1500, box: 400, g: 4, period: 1100, stirrers: 1, orbit: 40, rad: 4, amt: 0, hero: 1.6, relax: 0.05, damp: 0.92, lines: [0.5, 1.3], lean: 34 },
  sb: { soft: [0.55, 0.7, 1.4], lw: 0.1, ease: 1500, box: 480, g: 4, period: 1200, stirrers: 1, orbit: 52, rad: 5, amt: 0, hero: 1.6, relax: 0.05, damp: 0.92, lines: [0.5, 1.3], lean: 40 },
  sc: { soft: [0.55, 0.7, 1.4], lw: 0.1, ease: 1500, box: 560, g: 4, period: 1300, stirrers: 1, orbit: 64, rad: 6, amt: 0, hero: 1.6, relax: 0.05, damp: 0.92, lines: [0.5, 1.3], lean: 46 },
  // sx: sb crisp, as round 7.
  sx: { lw: 0.1, ease: 1500, box: 480, g: 4, period: 1200, stirrers: 1, orbit: 52, rad: 5, amt: 0, hero: 1.6, relax: 0.05, damp: 0.92, lines: [0.5, 1.3], lean: 40 },
  sd: { soft: [0.55, 0.7, 1.4], lw: 0.1, ease: 1500, box: 480, g: 4, period: 1200, stirrers: 1, orbit: 52, rad: 5, amt: 0, hero: 1.6, relax: 0.05, damp: 0.92, lines: [0.5, 1.3], lean: 40 },
  se: { soft: [0.4, 0.55, 0.8], lw: 0.18, ease: 1500, box: 480, g: 4, period: 1200, stirrers: 1, orbit: 52, rad: 5, amt: 0, hero: 1.6, relax: 0.05, damp: 0.92, lines: [0.5, 1.3], lean: 40 },
}[OPT]

const stage = document.getElementById("stage"), canvas = document.getElementById("c")
const ctx = canvas.getContext("2d")
const dpr = Math.min(devicePixelRatio || 1, 2)
const cell = dpr >= 2 ? 1.5 : 2
if (CFG.box === "window") { CFG.box = Math.ceil(Math.max(innerWidth, innerHeight) / 8) * 8; document.documentElement.style.overflow = "hidden" }
const B = CFG.box, cols = Math.round(B / cell), rows = cols
if (CFG.noVig) stage.style.cssText = `position:fixed;left:${(innerWidth - B) / 2}px;top:${(innerHeight - B) / 2}px`
stage.style.width = stage.style.height = `${cols * cell}px`
canvas.width = cols; canvas.height = rows
canvas.style.width = canvas.style.height = `${cols * cell}px`
const img = ctx.createImageData(cols, rows)
const G = CFG.g, gw = Math.ceil(B / G) + 2
const fluid = createFluid(gw, gw)
const cx = B / 2, cy = B / 2
let rgb = [0, 0, 0]
function readInk() {
  const c = getComputedStyle(document.documentElement).getPropertyValue("--foreground").trim()
  const x = document.createElement("canvas").getContext("2d"); x.fillStyle = c; x.fillRect(0, 0, 1, 1)
  rgb = [...x.getImageData(0, 0, 1, 1).data.slice(0, 3)]
}
readInk()
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readInk)

let clock = 0, into = 0, lastAng = null
// With ease, the surface starts still and the stirrer winds up from rest:
// its speed follows a smoothstep over EASE ms, so its angle is that curve's
// integral, and its push grows the same way.
const EASE = CFG.ease || 0
const wind = (t) => { if (!EASE || t >= EASE) return t - EASE / 2; if (t <= 0) return 0
  const u = t / EASE; return EASE * (u * u * u - (u * u * u * u) / 2) }
const strength = (t) => (EASE ? ss(t / EASE) : 1)
const angAt = (t) => (wind(t) / CFG.period) * Math.PI * 2 - Math.PI / 2
// The cursor, in the stage's CSS px, and where it was last step.
const cur = { x: 0, y: 0, on: false, px: 0, py: 0, fresh: true }
addEventListener("pointermove", (e) => { const r = stage.getBoundingClientRect(); cur.x = e.clientX - r.left; cur.y = e.clientY - r.top; cur.on = true })
document.documentElement.addEventListener("pointerleave", () => { cur.on = false; cur.fresh = true })
// Where the stirrer circles: the centre, or with lean, eased toward the cursor.
const hub = { x: B / 2, y: B / 2 }
const sp = { x: 0, y: 0, on: false }
function stir(t) {
  fluid.keep()
  if (CFG.lean) {
    let tx = B / 2, ty = B / 2
    if (cur.on) { const dx = cur.x - B / 2, dy = cur.y - B / 2, d = Math.hypot(dx, dy) || 1
      const m = CFG.lean * (1 - Math.exp(-d / 300)); tx += (dx / d) * m; ty += (dy / d) * m }
    hub.x += (tx - hub.x) * 0.08; hub.y += (ty - hub.y) * 0.08
  }
  if (CFG.cursor && cur.on) {
    // Like the hero's peek: stir along the path the cursor moved since last
    // step, so a fast swipe leaves an unbroken wake.
    if (cur.fresh) { cur.px = cur.x; cur.py = cur.y; cur.fresh = false }
    const dx = (cur.x - cur.px) / G, dy = (cur.y - cur.py) / G
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 1.5))
    for (let n = 1; n <= steps; n++)
      fluid.splat(cur.px / G + (dx * n) / steps, cur.py / G + (dy * n) / steps, (dx * CFG.cursor) / steps, (dy * CFG.cursor) / steps, CFG.rad * 1.4, 0.001 / steps)
    cur.px = cur.x; cur.py = cur.y
  }
  if (CFG.hero) {
    // Chase the point on the circle, eased like the hero's peek; the orbit
    // is widened so the eased path lands on the circle's radius.
    const a = angAt(t), R = CFG.orbit / 0.85
    const tx = hub.x + Math.cos(a) * R, ty = hub.y + Math.sin(a) * R
    if (!sp.on) { sp.x = tx; sp.y = ty; sp.on = true }
    const px = sp.x, py = sp.y
    sp.x += (tx - sp.x) * 0.3; sp.y += (ty - sp.y) * 0.3
    const dx = (sp.x - px) / G, dy = (sp.y - py) / G, f = strength(t)
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 1.5))
    for (let n = 1; n <= steps; n++)
      fluid.splat(px / G + (dx * n) / steps, py / G + (dy * n) / steps, (dx * CFG.hero * f) / steps, (dy * CFG.hero * f) / steps, CFG.rad, 0.001 / steps)
  }
  for (let s = 0; s < (CFG.hero ? 0 : CFG.stirrers); s++) {
    const off = (s * Math.PI * 2) / CFG.stirrers
    const a0 = angAt(t - 40) + off, a1 = angAt(t) + off
    const steps = 3
    for (let n = 1; n <= steps; n++) {
      const a = a0 + ((a1 - a0) * n) / steps
      const R = CFG.orbit + (CFG.wob || 0) * Math.sin(a * 3 + Math.sin(a * 1.7) * 2)
      const x = (hub.x + Math.cos(a) * R) / G, y = (hub.y + Math.sin(a) * R) / G
      const f = strength(t), tx = -Math.sin(a) * CFG.push * f / steps, ty = Math.cos(a) * CFG.push * f / steps
      // B carries no dye of its own: a whisper keeps the solver awake.
      fluid.splat(x, y, tx, ty, CFG.rad, (CFG.amt || 0.001) / steps)
    }
  }
  fluid.step()
  if (CFG.damp) for (let i = 0; i < fluid.vx.length; i++) { fluid.vx[i] *= CFG.damp; fluid.vy[i] *= CFG.damp }
  if (CFG.relax) { const { mx, my } = fluid
    for (let r = 0, i = 0; r < gw; r++) for (let c = 0; c < gw; c++, i++) { mx[i] += (c - mx[i]) * CFG.relax; my[i] += (r - my[i]) * CFG.relax } }
  if (CFG.lines || OPT === "rb" || OPT === "rc") caustic()
  if (CFG.decay) for (let i = 0; i < fluid.dye.length; i++) fluid.dye[i] *= CFG.decay
}

// How much the carried surface bunches up or spreads out at each node: the
// mapping's area change, |det J - 1|, which is where refraction focuses light.
const focus = new Float32Array(gw * gw), prevFocus = new Float32Array(gw * gw)
function caustic() {
  const { mx, my } = fluid
  prevFocus.set(focus)
  for (let r = 1; r < gw - 1; r++) for (let c = 1; c < gw - 1; c++) { const i = r * gw + c
    const a = (mx[i + 1] - mx[i - 1]) / 2, b = (mx[i + gw] - mx[i - gw]) / 2
    const d = (my[i + 1] - my[i - 1]) / 2, e = (my[i + gw] - my[i - gw]) / 2
    focus[i] = Math.abs(a * e - b * d - 1) }
}
const P = (x, y) => Math.sin(noise(x * 0.06, y * 0.06) * 12)
function lerp(a, j, fx, fy) { const top = a[j] + (a[j + 1] - a[j]) * fx
  const bot = a[j + gw] + (a[j + gw + 1] - a[j + gw]) * fx; return top + (bot - top) * fy }

function draw(t, blend) {
  const { dye, prevDye, mx, my, prevMx, prevMy } = fluid
  const data = img.data, phase = (t / 1000) * 1.6, ts = t / 1000
  const head = angAt(t)
  for (let r = 0, i = 0; r < rows; r++) {
    const py = r * cell + cell / 2
    for (let c = 0; c < cols; c++, i++) {
      const px = c * cell + cell / 2
      const gx = px / G, gy = py / G, x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0, j = y0 * gw + x0
      if (CFG.lines && focus[j] < 0.05 && prevFocus[j] < 0.05 && focus[j + 1] < 0.05 && focus[j + gw] < 0.05 && focus[j + gw + 1] < 0.05) { data[i * 4 + 3] = 0; continue }
      const p = lerp(prevDye, j, fx, fy) * (1 - blend) + lerp(dye, j, fx, fy) * blend
      const ux = lerp(prevMx, j, fx, fy) * (1 - blend) + lerp(mx, j, fx, fy) * blend
      const uy = lerp(prevMy, j, fx, fy) * (1 - blend) + lerp(my, j, fx, fy) * blend
      const w = noise(ux * G * 0.05 + ts * 0.35, uy * G * 0.05 - ts * 0.28)
      const band = Math.sin(w * 16 + phase)
      const dx = px - cx, dy = py - cy, rad = Math.hypot(dx, dy)
      let k = 0
      if (OPT === "a") {
        k = p * (1.15 + 0.75 * band)
      } else if (OPT === "b") {
        // Loader2: a 300° arc, solid at the head, dissolving behind it.
        let behind = (head - Math.atan2(dy, dx)) % (Math.PI * 2); if (behind < 0) behind += Math.PI * 2
        const along = 1 - behind / (Math.PI * 2 * 0.85)
        const ring = 1 - Math.abs(rad - CFG.orbit) / 3.6
        k = ring > 0 && along > 0 ? Math.min(ring * 1.6, 1) * (along ** 1.4 * 1.25) * (1 + 0.35 * band) : 0
      } else if (OPT === "ra") {
        // Ripples: contour bands of how far the water moved, so a stir
        // reads as rings spreading off the stirrer's path.
        const m = Math.hypot(ux - gx, uy - gy)
        k = ss((m - 0.12) / 0.7) * (0.6 + 0.4 * Math.sin(m * 5 - phase * 2))
      } else if (CFG.lines) {
        // Bigger stirs focus the light over wide patches, so only the
        // contours of that focusing draw, the net of lines on a pool floor.
        const f = lerp(prevFocus, j, fx, fy) * (1 - blend) + lerp(focus, j, fx, fy) * blend
        let l = 0
        for (const th of CFG.lines) { const z = (f - th) / (th * (CFG.lw || 0.22)); l = Math.max(l, Math.exp(-z * z)) }
        k = l * 1.15 * ss(f / CFG.lines[0])
        // Softer, like the hero's veil: the focus shades in as an even
        // ramp, so most of it sits between clear and solid and the Bayer
        // crosshatch shows, with the contour lines only half filled on top.
        if (CFG.soft) k = Math.max(l * CFG.soft[0], CFG.soft[1] * (1 - Math.exp(-Math.max(f - 0.1, 0) / CFG.soft[2])))
      } else if (OPT === "rb") {
        const f = lerp(prevFocus, j, fx, fy) * (1 - blend) + lerp(focus, j, fx, fy) * blend
        k = ss((f - 0.04) * 5)
      } else if (OPT === "rc") {
        // Pool: the same focusing lines over a wider, slower stir, so they
        // linger and fold into each other.
        const f = lerp(prevFocus, j, fx, fy) * (1 - blend) + lerp(focus, j, fx, fy) * blend
        k = ss((f - 0.06) * 4)
      } else {
        // A disc that eases out to clear at its rim, as the veil eases in.
        const edge = 1 - rad / (B / 2 - 2)
        const disc = edge > 0 ? Math.min(edge * 2.2, 1) ** 2.4 : 0
        k = disc * (0.42 + 0.3 * band) + p * 0.9 * disc
      }
      if (OPT[0] === "r" || (OPT[0] === "c" && !CFG.noVig)) { const e = 1 - rad / (B / 2 - 4); k *= e <= 0 ? 0 : Math.min(e * 2.5, 1) }
      data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]
      data[i * 4 + 3] = ss(k) > BAYER[(r & 7) * 8 + (c & 7)] ? 255 : 0
    }
  }
  ctx.putImageData(img, 0, 0)
}

// The ripple surface: a height field on a coarse grid over the whole
// window, stepped at 60Hz by the wave equation. The stirrer presses it down
// where it passes; the rings that spread from there bend the light, and the
// grain shows where they focus it (where the surface curves up, -∇²h > 0).
let wave = null
if (CFG.wave) {
  const WC = 4, wv = document.createElement("canvas")
  wv.style.cssText = "position:fixed;left:0;top:0;image-rendering:pixelated;pointer-events:none"
  document.body.prepend(wv)
  const wctx = wv.getContext("2d")
  const VW = innerWidth, VH = innerHeight
  const wcols = Math.ceil(VW / cell), wrows = Math.ceil(VH / cell)
  wv.width = wcols; wv.height = wrows
  wv.style.width = `${wcols * cell}px`; wv.style.height = `${wrows * cell}px`
  const wimg = wctx.createImageData(wcols, wrows)
  const nx = Math.ceil(VW / WC) + 3, ny = Math.ceil(VH / WC) + 3
  let h = new Float32Array(nx * ny), hp = new Float32Array(nx * ny)
  const lap = new Float32Array(nx * ny)
  // Rings fade out before they reach the edges, so nothing bounces back.
  const edge = new Float32Array(nx * ny)
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const d = Math.min(c, r, nx - 1 - c, ny - 1 - r) / 20
    edge[r * nx + c] = d >= 1 ? 1 : d <= 0 ? 0 : 1 - (1 - d) * (1 - d) * 0.25 }
  const ox = VW / 2 - B / 2, oy = VH / 2 - B / 2
  let wt = 0
  wave = {
    step(t) {
      const bob = CFG.wave.bob
      if (bob) {
        // The centre rises and falls; with drift it also wanders a little,
        // so the rings aren't perfectly concentric.
        const tt = wind(t) / 1000
        const x = (VW / 2 + (bob.drift ? Math.sin(tt * 0.9) * bob.drift : 0)) / WC + 1
        const y = (VH / 2 + (bob.drift ? Math.sin(tt * 1.3 + 1) * bob.drift * 0.7 : 0)) / WC + 1
        const push = strength(t) * bob.amp * Math.sin(tt * Math.PI * 2 * bob.hz)
        const R = Math.ceil(bob.r * 2)
        for (let r = Math.floor(y) - R; r <= Math.ceil(y) + R; r++) for (let c = Math.floor(x) - R; c <= Math.ceil(x) + R; c++) {
          const d2 = (c - x) ** 2 + (r - y) ** 2
          h[r * nx + c] += push * Math.exp(-d2 / (bob.r * bob.r)) }
      }
      for (let s = 0; s < (bob ? 0 : CFG.stirrers); s++) {
        const a = angAt(t) + (s * Math.PI * 2) / CFG.stirrers
        const R = CFG.orbit + (CFG.wob || 0) * Math.sin(a * 3 + Math.sin(a * 1.7) * 2)
        const x = (ox + cx + Math.cos(a) * R) / WC + 1, y = (oy + cy + Math.sin(a) * R) / WC + 1
        for (let r = Math.floor(y - 4); r <= Math.ceil(y + 4); r++) for (let c = Math.floor(x - 4); c <= Math.ceil(x + 4); c++) {
          const d2 = (c - x) ** 2 + (r - y) ** 2
          h[r * nx + c] -= strength(t) * CFG.wave.amp * 0.6 * Math.exp(-d2 / 2) }
      }
            for (let r = 1; r < ny - 1; r++) for (let c = 1, i = r * nx + 1; c < nx - 1; c++, i++) {
        // Nine points, so rings stay round instead of squaring off.
        const avg = (4 * (h[i - 1] + h[i + 1] + h[i - nx] + h[i + nx]) + h[i - nx - 1] + h[i - nx + 1] + h[i + nx - 1] + h[i + nx + 1]) / 20
        hp[i] = (2 * avg - hp[i]) * CFG.wave.damp * edge[i] }
      const sw = hp; hp = h; h = sw
    },
    draw() {
      for (let r = 1; r < ny - 1; r++) for (let c = 1, i = r * nx + 1; c < nx - 1; c++, i++)
        lap[i] = h[i - 1] + h[i + 1] + h[i - nx] + h[i + nx] - 4 * h[i]
      const d = wimg.data
      for (let r = 0, i = 0; r < wrows; r++) {
        const gy = (r * cell + cell / 2) / WC + 1, y0 = gy | 0, fy = gy - y0
        for (let c = 0; c < wcols; c++, i++) {
          const gx = (c * cell + cell / 2) / WC + 1, x0 = gx | 0, fx = gx - x0, j = y0 * nx + x0
          const top = lap[j] + (lap[j + 1] - lap[j]) * fx, bot = lap[j + nx] + (lap[j + nx + 1] - lap[j + nx]) * fx
          const L = -(top + (bot - top) * fy)
          const k = ss((L - (CFG.wave.th || 0.04)) * (CFG.wave.gain || 4))
          d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]
          d[i * 4 + 3] = k > BAYER[(r & 7) * 8 + (c & 7)] ? 255 : 0 }
      }
      wctx.putImageData(wimg, 0, 0)
    },
    advance(ms, clock) { const dt = 1000 / (CFG.wave.hz || 60); wt += ms; while (wt >= dt) { this.step(clock - wt); wt -= dt } },
  }
  if (CFG.noCore) canvas.style.visibility = "hidden"
}

function advance(ms) {
  if (wave) wave.advance(ms, clock + ms)
  clock += ms; into += ms
  while (into >= 40) { stir(clock - into + 40); into -= 40 }
  draw(clock, into / 40)
  if (wave) wave.draw()
}
// Warm up so the first frame already shows a full trail.
if (!EASE) for (let k = 0; k < (CFG.wave ? 100 : 40); k++) advance(40)
if (MANUAL || reduce) { draw(clock, 1); window.__tick = advance }
else { let last = performance.now()
  const frame = (now) => { advance(Math.min(now - last, 120)); last = now; requestAnimationFrame(frame) }
  requestAnimationFrame(frame) }
