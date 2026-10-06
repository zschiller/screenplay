/**
 * The area a 2D drawing touches, found by running it against a stand-in
 * context that records coordinates instead of painting. A canvas overlay can
 * then size itself to that area, so a redraw uploads what changed rather than
 * the whole view.
 *
 * Understands the calls the canvas overlays make: rects, paths (moveTo,
 * lineTo, arc, roundRect), and translate inside save/restore. Any other
 * method is a no-op and property writes are kept, so a drawing that strays
 * outside that set must widen `pad` or teach this file the call.
 */
export interface DrawBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Run `paint` against a recording context and return the box it would touch,
 * in its own coordinates, grown by `pad` plus the widest line width used.
 * `null` when it draws nothing.
 */
export function measureDraw(
  paint: (ctx: CanvasRenderingContext2D) => void,
  pad = 1
): DrawBounds | null {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  let lineWidth = 1
  let maxLineWidth = 0
  let dx = 0
  let dy = 0
  const stack: Array<[number, number]> = []
  const add = (x: number, y: number, r = 0) => {
    if (x - r + dx < left) left = x - r + dx
    if (y - r + dy < top) top = y - r + dy
    if (x + r + dx > right) right = x + r + dx
    if (y + r + dy > bottom) bottom = y + r + dy
  }
  const rect = (x: number, y: number, w: number, h: number) => {
    add(x, y)
    add(x + w, y + h)
  }
  const strokeRect = (x: number, y: number, w: number, h: number) => {
    if (lineWidth > maxLineWidth) maxLineWidth = lineWidth
    rect(x, y, w, h)
  }
  const methods: Record<string, (...a: number[]) => void> = {
    fillRect: rect,
    strokeRect,
    rect,
    roundRect: rect,
    moveTo: (x, y) => add(x!, y!),
    lineTo: (x, y) => add(x!, y!),
    arc: (x, y, r) => add(x!, y!, r),
    stroke: () => {
      if (lineWidth > maxLineWidth) maxLineWidth = lineWidth
    },
    translate: (x, y) => {
      dx += x!
      dy += y!
    },
    save: () => {
      stack.push([dx, dy])
    },
    restore: () => {
      ;[dx, dy] = stack.pop() ?? [0, 0]
    },
  }
  const noop = () => {}
  const props: Record<string | symbol, unknown> = {}
  const recorder = new Proxy(props, {
    get: (_, key) =>
      (typeof key === "string" && methods[key]) || props[key] || noop,
    set: (_, key, value) => {
      if (key === "lineWidth") lineWidth = value as number
      props[key] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  paint(recorder)
  if (left === Infinity) return null
  const grow = pad + maxLineWidth
  return {
    x: left - grow,
    y: top - grow,
    width: right - left + 2 * grow,
    height: bottom - top + 2 * grow,
  }
}
