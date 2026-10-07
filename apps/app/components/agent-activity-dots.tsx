"use client"

import { cn } from "@workspace/ui/lib/utils"

/**
 * AgentActivityDots — an "agent is running" indicator drawn as lucide's `Grip`
 * 3×3 dot grid where, instead of spinning, each dot fades in and out on its
 * own cadence so the grid shimmers in a long, organic-looking pattern. The
 * name carries the rule: these dots mean the agent is working, nothing else.
 *
 * **Use it only for LLM activity**: the agent thinking, a reply streaming, a
 * subagent (Task) running, a chat tab whose run is live. Anything else that is
 * merely in progress (loading data, a request in flight, a tool call running,
 * a sandbox booting) uses `Spinner` from `@workspace/ui/components/spinner`.
 * Keeping the two apart is what lets the grid mean "the model is working".
 *
 * It renders outside React's update loop on purpose, which is what keeps it
 * smooth while a reply streams:
 *
 * - The dots are HTML spans (masked to a circle), not SVG circles. WebKit (the Mac app's webview)
 *   hands an opacity animation on an HTML element to Core Animation, off the
 *   main thread, but animates SVG children on the main thread, so a busy page
 *   (a streaming reply, a canvas pan) froze the shimmer mid-fade.
 * - Each dot's timing is a fixed constant, so the server and client render the
 *   same markup and nothing is set in state.
 * - Every dot's animation starts at the document timeline's origin, so all
 *   AgentActivityDots on the page share one phase and one that re-mounts (a list
 *   re-keying, a row re-rendering) picks up where it was instead of jumping.
 */

// Grip's dot centres (lucide viewBox 0 0 24 24); each dot draws 4 units wide.
const DOTS: ReadonlyArray<readonly [number, number]> = [
  [5, 5],
  [12, 5],
  [19, 5],
  [5, 12],
  [12, 12],
  [19, 12],
  [5, 19],
  [12, 19],
  [19, 19],
]

// Seconds per dot. Durations sit between 0.9s and 1.9s and share no common
// beat, and the delays spread the dots across a cycle, so the nine stay out of
// phase with one another and the pattern takes minutes to repeat.
const TIMINGS: ReadonlyArray<readonly [duration: number, delay: number]> = [
  [1.37, -0.41],
  [1.02, -1.27],
  [1.71, -0.86],
  [1.19, -1.64],
  [1.53, -0.12],
  [0.94, -0.97],
  [1.83, -1.48],
  [1.11, -0.63],
  [1.62, -1.81],
]

/**
 * One dot as a mask over the whole box, drawn by the SVG renderer so it lands
 * on the same anti-aliased subpixel spot as lucide's glyph. Laid out as boxes,
 * the dots would snap to whole pixels and come out uneven at 12–14px.
 */
const dotMask = (cx: number, cy: number) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='${cx}' cy='${cy}' r='2'/%3E%3C/svg%3E") 0 0 / 100% 100%`

/** Pins every animation in the grid to the document timeline's origin. */
function syncToTimeline(grid: HTMLSpanElement | null) {
  if (!grid || typeof grid.getAnimations !== "function") return
  for (const animation of grid.getAnimations({ subtree: true })) {
    animation.startTime = 0
  }
}

export function AgentActivityDots({ className }: { className?: string }) {
  return (
    <span
      ref={syncToTimeline}
      data-slot="agent-activity-dots"
      aria-hidden="true"
      className={cn("relative inline-block size-4 shrink-0", className)}
    >
      {DOTS.map(([cx, cy], i) => {
        const [duration, delay] = TIMINGS[i]
        return (
          <span
            key={i}
            className="absolute inset-0 bg-current"
            style={{
              mask: dotMask(cx, cy),
              animation: `agent-dot-twinkle ${duration}s ease-in-out ${delay}s infinite`,
            }}
          />
        )
      })}
    </span>
  )
}
