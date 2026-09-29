/**
 * Paints a background colour over whatever sits under `canvas` as a fine
 * dither: solid behind the target elements' text, breaking into grain and then
 * nothing away from it, so text stays readable on top of a busy layer.
 *
 * The threshold is interleaved gradient noise, which scatters the grain like
 * blue noise instead of Bayer's checkerboard. The grain creeps and a value
 * noise billows the edge, so the veil is always gently moving. Each grain is solid or a soft wash, so what's underneath
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
  // The spacing of the grid distances are measured on, in CSS px.
  const COARSE = 8

  let W = 0
  let H = 0
  let dpr = 1
  let cell = 2
  let cols = 0
  let rows = 0
  let img: ImageData | null = null
  let dist = new Float32Array(0)
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
    // Resizing the bitmap clears it, so only when the size really changed;
    // the caller draws again straight after.
    const bw = Math.round(W * dpr)
    const bh = Math.round(H * dpr)
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw
      canvas.height = bh
    }
    // One grain per 3 device pixels on retina screens, 2 elsewhere.
    cell = dpr >= 2 ? 1.5 : 2
    cols = Math.ceil(W / cell)
    rows = Math.ceil(H / cell)
    if (off.width !== cols || off.height !== rows || !img) {
      off.width = cols
      off.height = rows
      img = octx.createImageData(cols, rows)
    }

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

    // Distance to the text changes slowly, so it's worked out on a coarse
    // grid and interpolated per grain: measuring every grain against every
    // line made each resize take most of a second.
    const gc = Math.ceil(W / COARSE) + 2
    const gr = Math.ceil(H / COARSE) + 2
    const grid = new Float32Array(gc * gr)
    for (let r = 0, i = 0; r < gr; r++) {
      for (let c = 0; c < gc; c++, i++) {
        const x = c * COARSE
        const y = r * COARSE
        let d = 1e9
        for (const [x0, y0, x1, y1] of rects) {
          const dx = Math.max(x0! - x, 0, x - x1!)
          const dy = Math.max(y0! - y, 0, y - y1!)
          d = Math.min(d, dx * dx + dy * dy)
        }
        grid[i] = Math.sqrt(d)
      }
    }
    dist = new Float32Array(cols * rows)
    const fade = new Int32Array(cols * rows)
    let n = 0
    for (let r = 0, i = 0; r < rows; r++) {
      const gy = (r * cell + cell / 2) / COARSE
      const y0 = Math.floor(gy)
      const fy = gy - y0
      for (let c = 0; c < cols; c++, i++) {
        const gx = (c * cell + cell / 2) / COARSE
        const x0 = Math.floor(gx)
        const fx = gx - x0
        const j = y0 * gc + x0
        const top = grid[j]! + (grid[j + 1]! - grid[j]!) * fx
        const bot = grid[j + gc]! + (grid[j + gc + 1]! - grid[j + gc]!) * fx
        const d = top + (bot - top) * fy
        dist[i] = d
        const k = 1 - d / FALL
        if (k < 1 && k > -0.4) fade[n++] = i
      }
    }
    band = fade.subarray(0, n)
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
    // The grain pattern creeps diagonally and the edge billows, so the veil
    // reads as moving rather than a still texture.
    const sx = Math.floor(t * 9)
    const sy = Math.floor(t * 5)
    const data = img.data
    for (let b = 0; b < band.length; b++) {
      const i = band[b]!
      const c = i % cols
      const r = (i - c) / cols
      const k = 1 - dist[i]! / FALL
      const n = noise(c * cell * 0.007 + t * 0.45, r * cell * 0.007 - t * 0.3)
      const kk = Math.min(Math.max(k + (n - 0.5) * 0.55, 0), 1)
      const v = kk * kk * (3 - 2 * kk)
      data[i * 4 + 3] = v > ign(c + sx, r - sy) ? 255 : v * 150
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
    /** Draws one frame now, e.g. right after `measure`. */
    drawOnce() {
      draw(performance.now())
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
