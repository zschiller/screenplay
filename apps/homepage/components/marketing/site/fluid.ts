/**
 * A small stable-fluids solver (Stam's semi-Lagrangian scheme) on a coarse
 * grid, for the hero veil's mouse peek (and the desktop app's launch spinner,
 * apps/desktop/launch). The pointer stirs the velocity and
 * drops dye, the dye is how far the veil opens, and each cell also carries
 * the coordinates of the "material" it holds, so a pattern drawn from those
 * coordinates gets swirled like marbled paper.
 *
 * Units are grid cells and steps. Each step also keeps the state before
 * it (`prev*`), so a caller stepping at a fixed rate can draw the frames in
 * between by blending the two. Everything decays back to rest, so a still
 * hero costs nothing: `step` returns early once the fluid is idle, and
 * otherwise only works on the region that's stirred.
 */
export function createFluid(w: number, h: number) {
  const n = w * h
  const vx = new Float32Array(n)
  const vy = new Float32Array(n)
  const dye = new Float32Array(n)
  const mx = new Float32Array(n)
  const my = new Float32Array(n)
  const prevDye = new Float32Array(n)
  const prevMx = new Float32Array(n)
  const prevMy = new Float32Array(n)
  let prevLit: [number, number, number, number] | null = null
  const curl = new Float32Array(n)
  const div = new Float32Array(n)
  const pressure = new Float32Array(n)
  let active = false
  /** Bounds of the cells holding dye, in cells: [x0, y0, x1, y1]. */
  let lit: [number, number, number, number] | null = null
  // The cells the solver works on this step, [x0, y0, x1, y1], kept 1 cell
  // in from the edge. Outside it everything is at rest.
  const M = 12
  const box = [0, 0, 0, 0]
  // The stirred cells, grown by each splat and recomputed each step.
  let hot: [number, number, number, number] | null = null
  const grow = (c: number, r: number) => {
    if (!hot) hot = [c, r, c, r]
    else {
      if (c < hot[0]) hot[0] = c
      if (r < hot[1]) hot[1] = r
      if (c > hot[2]) hot[2] = c
      if (r > hot[3]) hot[3] = r
    }
  }

  function rest() {
    vx.fill(0)
    vy.fill(0)
    dye.fill(0)
    for (let r = 0, i = 0; r < h; r++) {
      for (let c = 0; c < w; c++, i++) {
        mx[i] = c
        my[i] = r
      }
    }
    lit = null
    hot = null
    active = false
    keep()
  }
  // Remembers the state as it is now as the one before the next step.
  function keep() {
    prevDye.set(dye)
    prevMx.set(mx)
    prevMy.set(my)
    prevLit = lit && [...lit]
  }
  rest()

  // Carries every field along the velocity by looking back to where each
  // cell's contents came from. One pass for all five: where to look and how
  // to blend there is the same for each.
  const fields = 5
  const carried = new Float32Array(n * fields)
  function advect() {
    const all = [vx, vy, dye, mx, my]
    const [x0, y0, x1, y1] = box as [number, number, number, number]
    for (let r = y0; r <= y1; r++) {
      for (let c = x0, i = r * w + c; c <= x1; c++, i++) {
        let x = c - vx[i]!
        let y = r - vy[i]!
        x = x < 0 ? 0 : x > w - 1.001 ? w - 1.001 : x
        y = y < 0 ? 0 : y > h - 1.001 ? h - 1.001 : y
        const xi = x | 0
        const yi = y | 0
        const fx = x - xi
        const fy = y - yi
        const j = yi * w + xi
        for (let f = 0; f < fields; f++) {
          const a = all[f]!
          const top = a[j]! + (a[j + 1]! - a[j]!) * fx
          const bot = a[j + w]! + (a[j + w + 1]! - a[j + w]!) * fx
          carried[f * n + i] = top + (bot - top) * fy
        }
      }
    }
    for (let f = 0; f < fields; f++) {
      const a = all[f]!
      for (let r = y0; r <= y1; r++) {
        const from = f * n + r * w
        a.set(carried.subarray(from + x0, from + x1 + 1), r * w + x0)
      }
    }
  }

  // Pushes the swirls back up that the coarse grid would otherwise smooth
  // away, so the stirring curls instead of just smearing.
  function confine(strength: number) {
    for (let r = box[1]!; r <= box[3]!; r++) {
      for (let c = box[0]!, i = r * w + c; c <= box[2]!; c++, i++) {
        curl[i] = (vy[i + 1]! - vy[i - 1]! - vx[i + w]! + vx[i - w]!) / 2
      }
    }
    for (let r = Math.max(box[1]!, 2); r <= Math.min(box[3]!, h - 3); r++) {
      const c0 = Math.max(box[0]!, 2)
      for (
        let c = c0, i = r * w + c0;
        c <= Math.min(box[2]!, w - 3);
        c++, i++
      ) {
        const gx = (Math.abs(curl[i + 1]!) - Math.abs(curl[i - 1]!)) / 2
        const gy = (Math.abs(curl[i + w]!) - Math.abs(curl[i - w]!)) / 2
        const len = Math.hypot(gx, gy) + 1e-5
        vx[i]! += strength * (gy / len) * curl[i]!
        vy[i]! -= strength * (gx / len) * curl[i]!
      }
    }
  }

  // Viscosity: each cell's velocity is pulled toward its neighbours', so
  // the fluid moves as a thick body instead of breaking into ripples.
  const thick = new Float32Array(n * 2)
  function diffuse(amount: number) {
    const [x0, y0, x1, y1] = box as [number, number, number, number]
    for (let r = y0; r <= y1; r++) {
      for (let c = x0, i = r * w + c; c <= x1; c++, i++) {
        thick[i] =
          vx[i]! +
          amount *
            ((vx[i - 1]! + vx[i + 1]! + vx[i - w]! + vx[i + w]!) / 4 - vx[i]!)
        thick[n + i] =
          vy[i]! +
          amount *
            ((vy[i - 1]! + vy[i + 1]! + vy[i - w]! + vy[i + w]!) / 4 - vy[i]!)
      }
    }
    for (let r = y0; r <= y1; r++) {
      const at = r * w
      vx.set(thick.subarray(at + x0, at + x1 + 1), at + x0)
      vy.set(thick.subarray(n + at + x0, n + at + x1 + 1), at + x0)
    }
  }

  // Makes the velocity swirl rather than spread out or bunch up.
  function project() {
    const [x0, y0, x1, y1] = box as [number, number, number, number]
    for (let r = y0; r <= y1; r++) {
      for (let c = x0, i = r * w + c; c <= x1; c++, i++) {
        div[i] = (vx[i + 1]! - vx[i - 1]! + vy[i + w]! - vy[i - w]!) / 2
      }
    }
    pressure.fill(0)
    for (let k = 0; k < 12; k++) {
      for (let r = y0; r <= y1; r++) {
        for (let c = x0, i = r * w + c; c <= x1; c++, i++) {
          pressure[i] =
            (pressure[i - 1]! +
              pressure[i + 1]! +
              pressure[i - w]! +
              pressure[i + w]! -
              div[i]!) /
            4
        }
      }
    }
    for (let r = y0; r <= y1; r++) {
      for (let c = x0, i = r * w + c; c <= x1; c++, i++) {
        vx[i]! -= (pressure[i + 1]! - pressure[i - 1]!) / 2
        vy[i]! -= (pressure[i + w]! - pressure[i - w]!) / 2
      }
    }
  }

  return {
    /**
     * Each cell's velocity, in cells a step. A caller that keeps stirring
     * (the desktop launch spinner) damps it further so the fluid stays calm.
     */
    vx,
    vy,
    get lit() {
      return lit
    },
    get active() {
      return active
    },
    /** How much dye each cell holds. */
    get dye() {
      return dye
    },
    /** The same, before the last step. */
    prevDye,
    prevMx,
    prevMy,
    get prevLit() {
      return prevLit
    },
    keep,
    /** Where the material now in each cell started out, in cells. */
    get mx() {
      return mx
    },
    get my() {
      return my
    },
    /**
     * Stirs the fluid around (x, y) by (dx, dy) and drops `amount` of dye
     * within `radius`, all in cells.
     */
    splat(
      x: number,
      y: number,
      dx: number,
      dy: number,
      radius: number,
      amount: number
    ) {
      for (
        let r = Math.max(0, Math.floor(y - radius));
        r <= Math.min(h - 1, Math.ceil(y + radius));
        r++
      ) {
        for (
          let c = Math.max(0, Math.floor(x - radius));
          c <= Math.min(w - 1, Math.ceil(x + radius));
          c++
        ) {
          const d = Math.hypot(c - x, r - y)
          if (d > radius) continue
          grow(c, r)
          if (!lit) lit = [c, r, c, r]
          else {
            lit[0] = Math.min(lit[0], c)
            lit[1] = Math.min(lit[1], r)
            lit[2] = Math.max(lit[2], c)
            lit[3] = Math.max(lit[3], r)
          }
          const i = r * w + c
          // The solver leaves the cells along the edge alone, so a push
          // there would never die down and would keep stirring its
          // neighbours for good. They take dye only.
          if (c > 0 && r > 0 && c < w - 1 && r < h - 1) {
            const push = Math.exp(-(d * d) / (radius * radius * 0.25))
            vx[i]! += dx * push
            vy[i]! += dy * push
          }
          const e = Math.min((radius - d) / (radius * 0.65), 1)
          dye[i] = Math.max(
            dye[i]!,
            Math.min(dye[i]! + amount * e * e * (3 - 2 * e), 1)
          )
        }
      }
      active = true
    },
    /** One step of motion; a no-op once everything has settled. */
    step() {
      if (!active || !hot) return
      box[0] = Math.max(1, hot[0] - M)
      box[1] = Math.max(1, hot[1] - M)
      box[2] = Math.min(w - 2, hot[2] + M)
      box[3] = Math.min(h - 2, hot[3] + M)
      confine(0.1)
      diffuse(0.8)
      project()
      advect()
      let b: typeof lit = null
      hot = null
      for (let r = box[1]!; r <= box[3]!; r++) {
        for (let c = box[0]!, i = r * w + c; c <= box[2]!; c++, i++) {
          vx[i]! *= 0.975
          vy[i]! *= 0.975
          // The marbling slowly relaxes back to its unstirred pattern.
          mx[i]! += (c - mx[i]!) * 0.012
          my[i]! += (r - my[i]!) * 0.012
          dye[i]! *= 0.962
          if (
            Math.abs(vx[i]!) + Math.abs(vy[i]!) > 0.005 ||
            Math.abs(mx[i]! - c) + Math.abs(my[i]! - r) > 0.05
          )
            grow(c, r)
          if (dye[i]! < 0.02) {
            dye[i] = 0
            continue
          }
          grow(c, r)
          if (!b) b = [c, r, c, r]
          else {
            if (c < b[0]) b[0] = c
            if (c > b[2]) b[2] = c
            b[3] = r
          }
        }
      }
      // The cells along the edge only ever hold dye, which fades in place.
      const fade = (c: number, r: number) => {
        const i = r * w + c
        if (!dye[i]) return
        dye[i]! *= 0.962
        if (dye[i]! < 0.02) {
          dye[i] = 0
          return
        }
        grow(c, r)
        if (!b) b = [c, r, c, r]
        else {
          if (c < b[0]) b[0] = c
          if (r < b[1]) b[1] = r
          if (c > b[2]) b[2] = c
          if (r > b[3]) b[3] = r
        }
      }
      for (let c = 0; c < w; c++) {
        fade(c, 0)
        fade(c, h - 1)
      }
      for (let r = 1; r < h - 1; r++) {
        fade(0, r)
        fade(w - 1, r)
      }
      lit = b
      if (!hot) rest()
    },
    /** Drops everything back to rest, e.g. for a still frame. */
    rest,
  }
}
