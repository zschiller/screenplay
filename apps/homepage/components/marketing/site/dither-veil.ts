import { createFluid } from "./fluid"

/**
 * Paints a background colour over whatever sits under `canvas` as a fine
 * dither that thickens down the canvas, slowly at first: nothing above `span()`'s top,
 * solid from its bottom down, so text below that line stays readable on top
 * of a busy layer and the layer above it dissolves into grain. With a far
 * span it also thickens up the canvas to solid at the far span's top, so the
 * layer fades into the background at both ends the same way. A `band` holds
 * the veil at a set density from the top of the canvas down to a line, for a
 * bar that lies over it there.
 *
 * The threshold is interleaved gradient noise, which scatters the grain like
 * blue noise instead of Bayer's checkerboard, over an even ramp. The veil
 * holds still until the pointer stirs it. Each grain is solid or clear, with
 * nothing in between, so what's underneath is never greyed over.
 *
 * The canvas holds one pixel a grain and sizes itself over its parent, so it
 * should sit at the parent's top left.
 */
export function createDitherVeil(
  canvas: HTMLCanvasElement,
  span: () => [
    top: number,
    solid: number,
    far?: [solid: number, clear: number],
    band?: [bottom: number, density: number],
  ]
) {
  const ctx = canvas.getContext("2d")!
  const host = canvas.parentElement!

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

  // The spacing of the grid the peek is worked out on, in
  // CSS px.
  const COARSE = 8
  // How far around the pointer the veil clears, in CSS px.
  const PEEK = 60
  // How sharply the veil eases in down its span: 1 is an even ramp, higher
  // keeps more of the top clear.
  const EASE = 2.4

  let W = 0
  let H = 0
  let dpr = 1
  let cell = 2
  let cols = 0
  let rows = 0
  let img: ImageData | null = null
  let dist = new Float32Array(0)
  // Each grain's opacity before the peek.
  let base = new Float32Array(0)
  // Which grains are in the fade, each grain's dither threshold, and its
  // alpha with no peek. None of these change between measures, so a frame
  // only ever works out the grains under the peek.
  let inBand = new Uint8Array(0)
  let thr = new Float32Array(0)
  let still = new Uint8Array(0)
  // Which cells of the fluid's grid the peek reaches this frame, and which
  // it reached last frame: only grains in one or the other need redrawing.
  let open = new Uint8Array(0)
  let wasOpen = new Uint8Array(0)
  let gc = 0
  // The marbling noise at each node of the fluid, this frame.
  let marble = new Float32Array(0)
  // The dye shown this frame, on the same grid.
  let shown = new Float32Array(0)
  // Time into the fluid's current 40ms step.
  let into = 0
  // The pointer peek: where it's heading and where it's drawn (eased). It
  // stirs a little fluid on the coarse grid whose dye opens the veil and
  // whose flow swirls the marbling; `touched` is the grains it reached last
  // frame, to put back.
  const aim = { x: 0, y: 0, on: false }
  const peek = { x: 0, y: 0, fresh: true }
  let fluid: ReturnType<typeof createFluid> | null = null
  let touched: [number, number, number, number] | null = null
  let rgb = [255, 255, 255]
  let raf = 0
  let stirred = false
  let lastDraw = 0
  // sin by table, for the marbling: one lookup a grain, not a call.
  const SIN = new Float32Array(1024)
  for (let i = 0; i < 1024; i++) SIN[i] = Math.sin((i / 1024) * Math.PI * 2)
  const TURN = 1024 / (Math.PI * 2)
  const t0 = performance.now()

  function measure() {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    W = host.clientWidth
    H = host.clientHeight
    // One grain per 3 device pixels on retina screens, 2 elsewhere.
    cell = dpr >= 2 ? 1.5 : 2
    cols = Math.ceil(W / cell)
    rows = Math.ceil(H / cell)
    // The bitmap holds one pixel a grain and the compositor scales it up,
    // crisp, so a frame uploads a small texture, not one the size of the
    // screen. Laid out at a whole number of grains, so every grain is the
    // same size; the host clips the sliver that overhangs. Resizing the
    // bitmap clears it, so only when the size really changed; the caller
    // draws again straight after.
    if (canvas.width !== cols || canvas.height !== rows || !img) {
      canvas.width = cols
      canvas.height = rows
      img = ctx.createImageData(cols, rows)
    }
    canvas.style.width = `${cols * cell}px`
    canvas.style.height = `${rows * cell}px`
    canvas.style.imageRendering = "pixelated"

    gc = Math.ceil(W / COARSE) + 2
    const gr = Math.ceil(H / COARSE) + 2
    marble = new Float32Array(gc * gr)
    shown = new Float32Array(gc * gr)
    open = new Uint8Array(gc * gr)
    wasOpen = new Uint8Array(gc * gr)
    const [top, solid, far, band] = span()
    const fall = Math.max(solid - top, 1)
    dist = new Float32Array(cols * rows)
    base = new Float32Array(cols * rows)
    inBand = new Uint8Array(cols * rows)
    thr = new Float32Array(cols * rows)
    still = new Uint8Array(cols * rows)
    for (let r = 0, i = 0; r < rows; r++) {
      // How far above the solid line this row is.
      const y = r * cell + cell / 2
      // Above the far span's solid line the veil is solid too.
      const d = far && y <= far[0] ? 0 : Math.max(solid - y, 0)
      // Below the line it stays solid. Above
      // it the veil eases in, so the upper part of the span stays clear,
      // and eases in again towards the far span's solid line.
      const t = 1 - d / fall
      let k = d <= 0 ? 1.3 : t > 0 ? t ** EASE : t
      if (far && d > 0) {
        const u = (far[1] - y) / Math.max(far[1] - far[0], 1)
        k = Math.max(k, u > 0 ? u ** EASE : u)
      }
      // The band across the top is at least its own density all the way
      // down, then lets go over a short distance below it.
      if (band && d > 0) {
        const e = Math.min(Math.max(1 - (y - band[0]) / 28, 0), 1)
        k = Math.max(k, band[1] * e * e * (3 - 2 * e))
      }
      for (let c = 0; c < cols; c++, i++) {
        dist[i] = d
        base[i] = k
        thr[i] = ign(c, r)
        if (k < 1 && k > 0) {
          inBand[i] = 1
          const v = k * k * (3 - 2 * k)
          still[i] = v > thr[i]! ? 255 : 0
        } else still[i] = d <= 0 ? 255 : 0
      }
    }
    fluid = createFluid(gc, gr)
    touched = null
    peek.fresh = true
    fill()
  }

  // Paints every grain as it is with no peek.
  function fill() {
    if (!img) return
    const data = img.data
    const [R, G, B] = rgb
    for (let i = 0; i < dist.length; i++) {
      const j = i * 4
      data[j] = R!
      data[j + 1] = G!
      data[j + 2] = B!
      data[j + 3] = still[i]!
    }
  }

  // Eases the peek toward the pointer and stirs the fluid along the path it
  // moved since last frame, so a fast swipe leaves an unbroken, swirling
  // trail.
  function updatePeek(snap: boolean) {
    if (!fluid) return
    const R = PEEK / COARSE
    if (snap) {
      // A still frame: an unstirred hole right under the pointer.
      fluid.rest()
      if (aim.on) fluid.splat(aim.x / COARSE, aim.y / COARSE, 0, 0, R, 1)
      fluid.keep()
      peek.fresh = true
      return
    }
    fluid.keep()
    if (aim.on) {
      const px = peek.fresh ? aim.x : peek.x
      const py = peek.fresh ? aim.y : peek.y
      peek.x = peek.fresh ? aim.x : px + (aim.x - px) * 0.12
      peek.y = peek.fresh ? aim.y : py + (aim.y - py) * 0.12
      peek.fresh = false
      const dx = (peek.x - px) / COARSE
      const dy = (peek.y - py) / COARSE
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 1.5))
      for (let n = 1; n <= steps; n++) {
        fluid.splat(
          px / COARSE + (dx * n) / steps,
          py / COARSE + (dy * n) / steps,
          (dx * 1.6) / steps,
          (dy * 1.6) / steps,
          R,
          // Blooms open slowly rather than popping.
          0.12 / steps
        )
      }
    } else peek.fresh = true
    fluid.step()
  }

  function lerpMarble(j: number, fx: number, fy: number) {
    const top = marble[j]! + (marble[j + 1]! - marble[j]!) * fx
    const bot = marble[j + gc]! + (marble[j + gc + 1]! - marble[j + gc]!) * fx
    return top + (bot - top) * fy
  }

  // Redraws the grains in `rect`: as they are at rest or, with `peek`, with
  // a hole where the pointer is. Grains in `skip` are left alone.
  function paint(
    rect: [number, number, number, number],
    peek: boolean,
    skip: typeof touched,
    t: number
  ) {
    const data = img!.data
    const d = fluid && shown
    const phase = t * 1.6
    const step = cell / COARSE
    for (let r = rect[1]; r <= rect[3]; r++) {
      const skipRow = !!skip && r >= skip[1] && r <= skip[3]
      let i = r * cols + rect[0]
      if (!peek || !d) {
        for (let c = rect[0]; c <= rect[2]; c++, i++) {
          if (skipRow && c >= skip![0] && c <= skip![2]) continue
          data[i * 4 + 3] = still[i]!
        }
        continue
      }
      const gy = r * step
      const y0 = Math.floor(gy)
      const fy = gy - y0
      const row = y0 * gc
      for (let c = rect[0]; c <= rect[2]; c++, i++) {
        const gx = c * step
        const x0 = Math.floor(gx)
        const j = row + x0
        if (!open[j] && !wasOpen[j]) {
          // Nothing here now or last frame: on to the next cell.
          const skipTo = Math.ceil((x0 + 1) / step)
          i += skipTo - c - 1
          c = skipTo - 1
          continue
        }
        // Above the fade it's clear whatever the peek does.
        if (!inBand[i] && dist[i]! > 0) continue
        const fx = gx - x0
        const top = d[j]! + (d[j + 1]! - d[j]!) * fx
        const p =
          top + (d[j + gc]! + (d[j + gc + 1]! - d[j + gc]!) * fx - top) * fy
        if (p <= 0) {
          data[i * 4 + 3] = still[i]!
          continue
        }
        // Rather than a clean hole, the peek opens in marbled bands drawn
        // from where the fluid carried each spot from, so moving the mouse
        // stirs them into swirls.
        const w = lerpMarble(j, fx, fy)
        const k =
          base[i]! - p * (0.95 + 1.05 * SIN[((w * 16 + phase) * TURN) & 1023]!)
        const kk = k < 0 ? 0 : k > 1 ? 1 : k
        data[i * 4 + 3] = kk * kk * (3 - 2 * kk) > thr[i]! ? 255 : 0
      }
    }
  }

  // `full` repaints every grain. Otherwise, while the peek runs at the
  // display's rate, a frame only redraws the grains the peek covers and the
  // ones it covered last frame.
  function draw(now: number, snap = false, full = true) {
    if (!img) return
    const t = (now - t0) / 1000
    // The fluid steps every 40ms whatever the frame rate, so it looks the
    // same everywhere, and frames in between blend the last two steps. A
    // long gap (a background tab) catches up by a few steps, not all.
    const elapsed = lastDraw ? now - lastDraw : 40
    lastDraw = now
    into = Math.min(into + elapsed, 120)
    if (snap) {
      updatePeek(true)
      into = 0
    }
    while (into >= 40) {
      updatePeek(false)
      into -= 40
    }
    const blend = snap ? 1 : into / 40
    const now1 = fluid?.lit
    const was = fluid?.prevLit
    const lit: typeof touched =
      now1 && was
        ? [
            Math.min(now1[0], was[0]),
            Math.min(now1[1], was[1]),
            Math.max(now1[2], was[2]),
            Math.max(now1[3], was[3]),
          ]
        : (now1 ?? was ?? null)
    if (fluid && lit) {
      // The marbling is drawn from where the fluid carried each spot from.
      const { dye, mx, my, prevDye, prevMx, prevMy } = fluid
      const rows = marble.length / gc
      for (
        let r = Math.max(0, lit[1] - 2);
        r <= Math.min(rows - 1, lit[3] + 2);
        r++
      ) {
        for (
          let c = Math.max(0, lit[0] - 2);
          c <= Math.min(gc - 1, lit[2] + 2);
          c++
        ) {
          const j = r * gc + c
          shown[j] = prevDye[j]! + (dye[j]! - prevDye[j]!) * blend
          const ux = prevMx[j]! + (mx[j]! - prevMx[j]!) * blend
          const uy = prevMy[j]! + (my[j]! - prevMy[j]!) * blend
          marble[j] = noise(
            ux * COARSE * 0.022 + t * 0.35,
            uy * COARSE * 0.022 - t * 0.28
          )
        }
      }
      // A cell is open if any of its four corners holds dye.
      for (
        let r = Math.max(0, lit[1] - 2);
        r <= Math.min(rows - 2, lit[3] + 2);
        r++
      ) {
        for (
          let c = Math.max(0, lit[0] - 2);
          c <= Math.min(gc - 2, lit[2] + 2);
          c++
        ) {
          const j = r * gc + c
          if (
            shown[j]! > 0 ||
            shown[j + 1]! > 0 ||
            shown[j + gc]! > 0 ||
            shown[j + gc + 1]! > 0
          )
            open[j] = 1
        }
      }
    }
    const box: typeof touched = lit
      ? [
          Math.max(0, Math.floor(((lit[0] - 1) * COARSE) / cell)),
          Math.max(0, Math.floor(((lit[1] - 1) * COARSE) / cell)),
          Math.min(cols - 1, Math.ceil(((lit[2] + 1) * COARSE) / cell)),
          Math.min(rows - 1, Math.ceil(((lit[3] + 1) * COARSE) / cell)),
        ]
      : null
    let dirty: number[] | null = null
    if (full) {
      fill()
      dirty = [0, 0, cols - 1, rows - 1]
    }
    // Redraw the grains the peek covers now and put back the ones it
    // covered last frame. Grains above the fade stay clear.
    for (const b of [touched, box]) {
      if (!b) continue
      if (b === box) paint(b, true, null, t)
      else paint(b, false, box, t)
      dirty = dirty
        ? [
            Math.min(dirty[0]!, b[0]),
            Math.min(dirty[1]!, b[1]),
            Math.max(dirty[2]!, b[2]),
            Math.max(dirty[3]!, b[3]),
          ]
        : [...b]
    }
    touched = box
    const spare = wasOpen
    wasOpen = open
    open = spare
    open.fill(0)
    // Nothing under the peek and nothing to put back: the canvas stands.
    if (!dirty) return
    const [x0, y0, x1, y1] = dirty as [number, number, number, number]
    ctx.putImageData(img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1)
  }

  function frame(now: number) {
    // The peek's fluid runs at the display's rate so it moves smoothly.
    // Otherwise the veil is still, so it's drawn once more to put back what
    // the peek last touched and then left alone.
    if (aim.on || fluid?.active) {
      draw(now, false, false)
      stirred = true
    } else if (stirred) {
      stirred = false
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
    /** Re-reads the layout; call when the host or the line moves. */
    measure,
    /** Draws one frame now, e.g. right after `measure`. */
    drawOnce() {
      draw(performance.now(), true)
    },
    /**
     * Clears a hole around a point (in the host's CSS px) to peek at what's
     * underneath, or stops with `null`. The hole follows with a trail that
     * fades back in.
     */
    peekAt(point: { x: number; y: number } | null) {
      if (point) Object.assign(aim, point)
      aim.on = !!point
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
