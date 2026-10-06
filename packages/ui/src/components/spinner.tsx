import { cn } from "@workspace/ui/lib/utils"
import { CircleNotchIcon } from "@workspace/ui/components/icons"

/**
 * The progress spinner: loading data, a request in flight, a tool call running,
 * a sandbox booting. It is **not** for LLM activity (the agent thinking, a reply
 * streaming, a subagent running); the app uses its 9-dot `GripSpinner`
 * (`apps/app/components/grip-spinner.tsx`) for that, so the grid alone means
 * "the model is working".
 *
 * It turns as one flat glyph about the middle of its own box:
 *
 * - The weight is pinned to Regular, the weight every spinner size (16px and
 *   under) shows anyway, so the spinner is one plain svg. An unpinned icon
 *   carries both weights as a nested svg and is a size container, which are
 *   the likeliest reasons the desktop app's WebKit turned it about a point
 *   off its middle, so it wobbled as it spun.
 * - The pivot is the border box's centre, named outright rather than left to
 *   the engine's SVG default (`view-box`), and the spin runs on its own layer,
 *   so the engine turns one drawn image instead of redrawing it at each
 *   angle and snapping it to the pixel grid.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <CircleNotchIcon
      role="status"
      aria-label="Loading"
      weight="regular"
      className={cn(
        "size-4 origin-center animate-spin will-change-transform [transform-box:border-box]",
        className
      )}
      {...props}
    />
  )
}

export { Spinner }
