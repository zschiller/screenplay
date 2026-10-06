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
  if (bounds) {
    // Only the part inside the view.
    const x = Math.max(0, Math.floor(bounds.x))
    const y = Math.max(0, Math.floor(bounds.y))
    const width = Math.min(box.width, Math.ceil(bounds.x + bounds.width)) - x
    const height = Math.min(box.height, Math.ceil(bounds.y + bounds.height)) - y
    if (width <= 0 || height <= 0) return beginUnderlayDraw(canvas, true)
    boundedCanvases.add(canvas)
    canvas.style.left = `${x}px`
    canvas.style.top = `${y}px`
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr
      canvas.height = height * dpr
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr)
    return ctx
  }
  if (boundedCanvases.delete(canvas)) {
    canvas.style.left = ""
    canvas.style.top = ""
  }
  canvas.style.width = `${box.width}px`
  canvas.style.height = `${box.height}px`
  if (canvas.width !== box.width * dpr || canvas.height !== box.height * dpr) {
    canvas.width = box.width * dpr
    canvas.height = box.height * dpr
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.scale(dpr, dpr)
  return ctx
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
      canvas.style.width = `${r.width}px`
      canvas.style.height = `${r.height}px`
      // A released canvas stays released until it next draws.
      if (canvas.width === 0 && canvas.height === 0) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = r.width * dpr
      canvas.height = r.height * dpr
    })
    observer.observe(parent)
    return () => {
      observer.disconnect()
      containerSizes.delete(canvas)
    }
  }, [canvasRef])
}
