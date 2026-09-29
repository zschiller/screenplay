/**
 * A small stable-fluids solver (Stam's semi-Lagrangian scheme) on a coarse
 * grid, for the hero veil's mouse peek. The pointer stirs the velocity and
 * drops dye, the dye is how far the veil opens, and each cell also carries
 * the coordinates of the "material" it holds, so a pattern drawn from those
 * coordinates gets swirled like marbled paper.
 *
 * Units are grid cells and frames. Everything decays back to rest, so a
 * still hero costs nothing: `step` returns early once the fluid is idle.
 */
export function createFluid(w: number, h: number) {
  const n = w * h
  let vx = new Float32Array(n)
  let vy = new Float32Array(n)
  let dye = new Float32Array(n)
  let mx = new Float32Array(n)
  let my = new Float32Array(n)
  let tmp = new Float32Array(n)
  const curl = new Float32Array(n)
  const div = new Float32Array(n)
  const pressure = new Float32Array(n)
  let active = false
  /** Bounds of the cells holding dye, in cells: [x0, y0, x1, y1]. */
  let lit: [number, number, number, number] | null = null

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
    active = false
  }
  rest()

  const at = (a: Float32Array<ArrayBuffer>, x: number, y: number) => {
    x = Math.min(Math.max(x, 0), w - 1.001)
    y = Math.min(Math.max(y, 0), h - 1.001)
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const i = y0 * w + x0
    const top = a[i]! + (a[i + 1]! - a[i]!) * fx
    const bot = a[i + w]! + (a[i + w + 1]! - a[i + w]!) * fx
    return top + (bot - top) * fy
  }

  // Carries a field along the velocity by looking back to where each cell's
  // contents came from.
  function advect(a: Float32Array<ArrayBuffer>) {
    for (let r = 0, i = 0; r < h; r++) {
      for (let c = 0; c < w; c++, i++) {
        tmp[i] = at(a, c - vx[i]!, r - vy[i]!)
      }
    }
    const out = tmp
    tmp = a
    return out
  }

  // Pushes the swirls back up that the coarse grid would otherwise smooth
  // away, so the stirring curls instead of just smearing.
  function confine(strength: number) {
    for (let r = 1; r < h - 1; r++) {
      for (let c = 1, i = r * w + 1; c < w - 1; c++, i++) {
        curl[i] = (vy[i + 1]! - vy[i - 1]! - vx[i + w]! + vx[i - w]!) / 2
      }
    }
    for (let r = 2; r < h - 2; r++) {
      for (let c = 2, i = r * w + 2; c < w - 2; c++, i++) {
        const gx = (Math.abs(curl[i + 1]!) - Math.abs(curl[i - 1]!)) / 2
        const gy = (Math.abs(curl[i + w]!) - Math.abs(curl[i - w]!)) / 2
        const len = Math.hypot(gx, gy) + 1e-5
        vx[i]! += strength * (gy / len) * curl[i]!
        vy[i]! -= strength * (gx / len) * curl[i]!
      }
    }
  }

  // Makes the velocity swirl rather than spread out or bunch up.
  function project() {
    for (let r = 1; r < h - 1; r++) {
      for (let c = 1, i = r * w + 1; c < w - 1; c++, i++) {
        div[i] = (vx[i + 1]! - vx[i - 1]! + vy[i + w]! - vy[i - w]!) / 2
      }
    }
    pressure.fill(0)
    for (let k = 0; k < 12; k++) {
      for (let r = 1; r < h - 1; r++) {
        for (let c = 1, i = r * w + 1; c < w - 1; c++, i++) {
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
    for (let r = 1; r < h - 1; r++) {
      for (let c = 1, i = r * w + 1; c < w - 1; c++, i++) {
        vx[i]! -= (pressure[i + 1]! - pressure[i - 1]!) / 2
        vy[i]! -= (pressure[i + w]! - pressure[i - w]!) / 2
      }
    }
  }

  return {
    get lit() {
      return lit
    },
    dye: (x: number, y: number) => at(dye, x, y),
    /** Where the material now at (x, y) started out, in cells. */
    material: (x: number, y: number): [number, number] => [
      at(mx, x, y),
      at(my, x, y),
    ],
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
          if (!lit) lit = [c, r, c, r]
          else {
            lit[0] = Math.min(lit[0], c)
            lit[1] = Math.min(lit[1], r)
            lit[2] = Math.max(lit[2], c)
            lit[3] = Math.max(lit[3], r)
          }
          const i = r * w + c
          const push = Math.exp(-(d * d) / (radius * radius * 0.25))
          vx[i]! += dx * push
          vy[i]! += dy * push
          const e = Math.min((radius - d) / (radius * 0.65), 1)
          dye[i] = Math.max(
            dye[i]!,
            Math.min(dye[i]! + amount * e * e * (3 - 2 * e), 1)
          )
        }
      }
      active = true
    },
    /** One frame of motion; a no-op once everything has settled. */
    step() {
      if (!active) return
      confine(0.5)
      project()
      vx = advect(vx)
      vy = advect(vy)
      dye = advect(dye)
      mx = advect(mx)
      my = advect(my)
      let b: typeof lit = null
      let moving = false
      for (let r = 0, i = 0; r < h; r++) {
        for (let c = 0; c < w; c++, i++) {
          vx[i]! *= 0.965
          vy[i]! *= 0.965
          if (Math.abs(vx[i]!) + Math.abs(vy[i]!) > 0.005) moving = true
          // The marbling slowly relaxes back to its unstirred pattern.
          mx[i]! += (c - mx[i]!) * 0.012
          my[i]! += (r - my[i]!) * 0.012
          dye[i]! *= 0.955
          if (dye[i]! < 0.02) {
            dye[i] = 0
            continue
          }
          if (!b) b = [c, r, c, r]
          else {
            if (c < b[0]) b[0] = c
            if (c > b[2]) b[2] = c
            b[3] = r
          }
        }
      }
      lit = b
      if (!b && !moving) rest()
    },
    /** Drops everything back to rest, e.g. for a still frame. */
    rest,
  }
}
