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

/**
 * Ready an underlay canvas to draw: sized to its container at the device pixel
 * ratio, cleared, and scaled to CSS pixels. Returns `null`, after releasing
 * the backing store, when there is nothing to draw.
 */
export function beginUnderlayDraw(
  canvas: HTMLCanvasElement,
  empty: boolean
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
  const box = (canvas.parentElement ?? canvas).getBoundingClientRect()
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
      canvas.style.width = `${r.width}px`
      canvas.style.height = `${r.height}px`
      // A released canvas stays released until it next draws.
      if (canvas.width === 0 && canvas.height === 0) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = r.width * dpr
      canvas.height = r.height * dpr
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [canvasRef])
}
