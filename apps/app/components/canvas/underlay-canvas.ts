import { useEffect, type RefObject } from "react"

/**
 * The underlays (resize-snap ghosts, the group-merge preview, the "+ frame"
 * placeholders) each draw on a canvas the size of the view, and each has
 * something to draw only during its own gesture or tool. A cleared canvas
 * still holds its whole backing store, width × height × 4 bytes at the device
 * pixel ratio (17MB on a Retina laptop), and the browser still composites it
 * on every frame of a pan or zoom. So an underlay with nothing to draw drops
 * its backing store to 0×0 and takes it back when it next draws: it looks the
 * same, empty either way.
 */

/** The grid, in device pixels, a bounded canvas's size rounds up to. */
const GRID = 64

/** Each bounded canvas's size in device pixels, kept while it fits the drawing. */
const boundedSizes = new WeakMap<
  HTMLCanvasElement,
  { width: number; height: number }
>()

/** Underlays drawn to a part of the view (`bounds`): their size is their own. */
const boundedCanvases = new WeakSet<HTMLCanvasElement>()

/** Each underlay's container size, kept by {@link useUnderlayCanvasSize}. */
const containerSizes = new WeakMap<
  HTMLCanvasElement,
  { width: number; height: number }
>()

/**
 * Ready an underlay canvas to draw: sized to its container at the device pixel
 * ratio, cleared, and scaled to CSS pixels. Returns `null`, after releasing
 * the backing store, when there is nothing to draw.
 *
 * Sizes and positions are whole device pixels, so each canvas pixel lands on
 * one screen pixel at any pixel ratio (page zoom makes it fractional): a canvas
 * stretched by a fraction, or placed between device pixels, blurs and shifts
 * its 1px lines off the edges they trace, and shifts them again as it moves.
 */
export function beginUnderlayDraw(
  canvas: HTMLCanvasElement,
  empty: boolean,
  /**
   * The area the drawing covers, in the container's CSS pixels: the canvas
   * covers only that, so a redraw uploads that much and not the whole view.
   * Draw in container coordinates as usual.
   */
  bounds?: { x: number; y: number; width: number; height: number }
): CanvasRenderingContext2D | null {
  if (empty) {
    boundedSizes.delete(canvas)
    if (canvas.width !== 0 || canvas.height !== 0) {
      canvas.width = 0
      canvas.height = 0
    }
    return null
  }
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  const dpr = window.devicePixelRatio || 1
  // The container, not the canvas: a released canvas has no size of its own.
  // The observer's last size when it has one: reading the box here would
  // force a layout on every pointer move of a resize, mid-reflow.
  const box =
    containerSizes.get(canvas) ??
    (canvas.parentElement ?? canvas).getBoundingClientRect()
  const viewWidth = Math.round(box.width * dpr)
  const viewHeight = Math.round(box.height * dpr)
  if (bounds) {
    // Only the part inside the view, in device pixels.
    const left = Math.max(0, Math.floor(bounds.x * dpr))
    const top = Math.max(0, Math.floor(bounds.y * dpr))
    const right = Math.min(
      viewWidth,
      Math.ceil((bounds.x + bounds.width) * dpr)
    )
    const bottom = Math.min(
      viewHeight,
      Math.ceil((bounds.y + bounds.height) * dpr)
    )
    let width = right - left
    let height = bottom - top
    if (width <= 0 || height <= 0) return beginUnderlayDraw(canvas, true)
    // Keep the backing store while the drawing still fits it and fills a
    // good part of it, so a box that slides or grows on each pointer move
    // moves the canvas instead of reallocating it. A new one gets room to
    // grow.
    const have = boundedSizes.get(canvas)
    if (
      have &&
      width <= have.width &&
      height <= have.height &&
      width * height * 4 >= have.width * have.height
    ) {
      width = have.width
      height = have.height
    } else {
      width = Math.min(viewWidth, Math.ceil((width * 1.25) / GRID) * GRID)
      height = Math.min(viewHeight, Math.ceil((height * 1.25) / GRID) * GRID)
      boundedSizes.set(canvas, { width, height })
    }
    const x = Math.max(0, Math.min(left, viewWidth - width))
    const y = Math.max(0, Math.min(top, viewHeight - height))
    boundedCanvases.add(canvas)
    canvas.style.left = `${x / dpr}px`
    canvas.style.top = `${y / dpr}px`
    setCanvasSize(canvas, width, height, dpr)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr, 0, 0, dpr, -x, -y)
    return ctx
  }
  boundedSizes.delete(canvas)
  if (boundedCanvases.delete(canvas)) {
    canvas.style.left = ""
    canvas.style.top = ""
  }
  setCanvasSize(canvas, viewWidth, viewHeight, dpr)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.scale(dpr, dpr)
  return ctx
}

/**
 * Size a canvas to whole device pixels, its CSS size exactly that many device
 * pixels. The backing store is set only when it changes: setting it
 * reallocates.
 */
function setCanvasSize(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  dpr: number
) {
  canvas.style.width = `${width / dpr}px`
  canvas.style.height = `${height / dpr}px`
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
}

/** Keep an underlay canvas sized to its container while it holds a drawing. */
export function useUnderlayCanvasSize(
  canvasRef: RefObject<HTMLCanvasElement | null>
) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const observer = new ResizeObserver(() => {
      const r = parent.getBoundingClientRect()
      containerSizes.set(canvas, { width: r.width, height: r.height })
      if (boundedCanvases.has(canvas)) return
      const dpr = window.devicePixelRatio || 1
      const width = Math.round(r.width * dpr)
      const height = Math.round(r.height * dpr)
      // A released canvas stays released until it next draws.
      if (canvas.width === 0 && canvas.height === 0) {
        canvas.style.width = `${width / dpr}px`
        canvas.style.height = `${height / dpr}px`
        return
      }
      setCanvasSize(canvas, width, height, dpr)
    })
    observer.observe(parent)
    return () => {
      observer.disconnect()
      containerSizes.delete(canvas)
    }
  }, [canvasRef])
}
