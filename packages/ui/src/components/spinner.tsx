import { cn } from "@workspace/ui/lib/utils"
import { CircleNotchIcon } from "@workspace/ui/components/icons"

/**
 * The progress spinner: loading data, a request in flight, a tool call running,
 * a sandbox booting. It is **not** for LLM activity (the agent thinking, a reply
 * streaming, a subagent running); the app uses its 9-dot `GripSpinner`
 * (`apps/app/components/grip-spinner.tsx`) for that, so the grid alone means
 * "the model is working".
 *
 * The ring turns inside a still svg: the spin is on the glyph's path, about
 * the middle of the view box, not on the svg's own box.
 *
 * - Spinning the box makes WebKit (the desktop app) give it a layer of its
 *   own. Wherever the box doesn't land on a whole device pixel, which is most
 *   places it sits beside or centred with text, WebKit grows that layer to the
 *   pixel grid and pivots it a device pixel away from the drawing, so the ring
 *   orbits its middle by up to 0.8px. Pinning the pivot, `will-change` and a
 *   spinning wrapper all leave that layer in place; a path gets no layer.
 * - The path's `origin-center` is the view box's middle (SVG's default
 *   `transform-box`), which is the ring's. Don't set `fill-box`: the notch
 *   makes the glyph's own box off-centre.
 * - The weight is pinned to Regular, the weight every spinner size (16px and
 *   under) shows anyway, so the glyph is one path directly under the svg.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <CircleNotchIcon
      role="status"
      aria-label="Loading"
      weight="regular"
      className={cn(
        "size-4 [&>path]:origin-center [&>path]:animate-spin",
        className
      )}
      {...props}
    />
  )
}

export { Spinner }
