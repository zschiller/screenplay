/**
 * Paints a background colour over whatever sits under `canvas` as a fine
 * dither: solid behind the target elements' text, breaking into grain and then
 * nothing away from it, so text stays readable on top of a busy layer.
 *
 * The threshold is interleaved gradient noise, which scatters the grain like
 * blue noise instead of Bayer's checkerboard, and a slow value noise keeps the
 * edge drifting. Each grain is solid or a soft wash, so what's underneath
 * fades under a smooth gradient and the dots only add texture.
 *
 * The canvas must fill its parent (`width/height: 100%`): a positioned canvas
 * otherwise keeps its bitmap size and draws at twice the size on 2x screens.
 */
export function createDitherVeil(
  canvas: HTMLCanvasElement,
  targets: () => Element[]
) {
  const ctx = canvas.getContext("2d")!
  const host = canvas.parentElement!
  const off = document.createElement("canvas")
  const octx = off.getContext("2d")!

  // Value noise from a fixed permutation, so every visit looks the same.
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
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const u = xf * xf * (3 - 2 * xf)
    const v = yf * yf * (3 - 2 * yf)
    const a = hash(xi, yi)
    const b = hash(xi + 1, yi)
    const c = hash(xi, yi + 1)
    const d = hash(xi + 1, yi + 1)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
  const fract = (v: number) => v - Math.floor(v)
  const ign = (x: number, y: number) =>
    fract(52.9829189 * fract(0.06711056 * x + 0.00583715 * y))

  // How far the solid core reaches past the text, and how long the fade is,
  // in CSS px.
  const PAD = 12
  const FALL = 190

  let W = 0
  let H = 0
  let dpr = 1
  let cell = 2
  let cols = 0
  let rows = 0
  let img: ImageData | null = null
  let dist = new Float32Array(0)
  let threshold = new Float32Array(0)
  // The grains in the fade, the only ones that change from frame to frame.
  let band = new Int32Array(0)
  let rgb = [255, 255, 255]
  let raf = 0
  let last = 0
  const t0 = performance.now()

  function measure() {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    W = host.clientWidth
    H = host.clientHeight
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    // One grain per 3 device pixels on retina screens, 2 elsewhere.
    cell = dpr >= 2 ? 1.5 : 2
    cols = Math.ceil(W / cell)
    rows = Math.ceil(H / cell)
    off.width = cols
    off.height = rows
    img = octx.createImageData(cols, rows)

    // Hug the text line by line rather than whole blocks, so what's
    // underneath shows wherever there are no words.
    const s = host.getBoundingClientRect()
    const rects = targets()
      .flatMap((n) => {
        const range = document.createRange()
        range.selectNodeContents(n)
        return [...range.getClientRects()].filter((r) => r.width > 1)
      })
      .map((r) => [
        r.left - s.left - PAD,
        r.top - s.top - PAD,
        r.right - s.left + PAD,
        r.bottom - s.top + PAD,
      ])

    // The text doesn't move, so each grain's distance to it and its
    // threshold are worked out once here.
    dist = new Float32Array(cols * rows)
    threshold = new Float32Array(cols * rows)
    for (let r = 0, i = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, i++) {
        const x = c * cell + cell / 2
        const y = r * cell + cell / 2
        let d = 1e9
        for (const [x0, y0, x1, y1] of rects) {
          const dx = Math.max(x0! - x, 0, x - x1!)
          const dy = Math.max(y0! - y, 0, y - y1!)
          d = Math.min(d, Math.hypot(dx, dy))
        }
        dist[i] = d
        threshold[i] = ign(c, r)
      }
    }
    const fade: number[] = []
    for (let i = 0; i < dist.length; i++) {
      const k = 1 - dist[i]! / FALL
      if (k < 1 && k > -0.25) fade.push(i)
    }
    band = Int32Array.from(fade)
    fill()
  }

  // Paints the grains that never change: solid behind the text, clear far
  // from it.
  function fill() {
    if (!img) return
    const data = img.data
    const [R, G, B] = rgb
    for (let i = 0; i < dist.length; i++) {
      const j = i * 4
      data[j] = R!
      data[j + 1] = G!
      data[j + 2] = B!
      data[j + 3] = dist[i]! <= 0 ? 255 : 0
    }
  }

  function draw(now: number) {
    if (!img) return
    const t = (now - t0) / 1000
    const data = img.data
    for (let b = 0; b < band.length; b++) {
      const i = band[b]!
      const k = 1 - dist[i]! / FALL
      const x = (i % cols) * cell
      const y = Math.floor(i / cols) * cell
      const n = noise(x * 0.008 + t * 0.2, y * 0.008 - t * 0.12) - 0.5
      const kk = Math.min(Math.max(k + n * 0.35, 0), 1)
      const v = kk * kk * (3 - 2 * kk)
      data[i * 4 + 3] = v > threshold[i]! ? 255 : v * 150
    }
    octx.putImageData(img, 0, 0)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(off, 0, 0, cols * cell, rows * cell)
  }

  function frame(now: number) {
    // 25fps is plenty for a slow drift.
    if (now - last > 40) {
      last = now
      draw(now)
    }
    raf = requestAnimationFrame(frame)
  }

  return {
    /** Reads the colour to paint, e.g. after a theme change. */
    setColor(color: string) {
      const c = document.createElement("canvas")
      c.width = c.height = 1
      const x = c.getContext("2d")!
      x.fillStyle = color
      x.fillRect(0, 0, 1, 1)
      rgb = [...x.getImageData(0, 0, 1, 1).data.slice(0, 3)]
      fill()
    },
    /** Re-reads the layout; call when the host or its text changes size. */
    measure,
    /** Draws one still frame. */
    drawOnce() {
      draw(t0)
    },
    start() {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(frame)
    },
    stop() {
      cancelAnimationFrame(raf)
    },
  }
}
