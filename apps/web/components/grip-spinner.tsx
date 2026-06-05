"use client"

import { useEffect, useState } from "react"

/**
 * GripSpinner — an "agent is running" indicator that reuses lucide's `Grip`
 * 3×3 dot grid but, instead of spinning, twinkles each dot independently:
 * every dot fades in and out on its own randomized cadence so the grid
 * shimmers in a non-repeating, organic pattern.
 *
 * The dot coordinates mirror lucide-react's `Grip` icon exactly so it reads as
 * the same glyph at rest. Randomized delays/durations are applied in an effect
 * (post-hydration) to avoid SSR mismatches — the server renders a calm,
 * deterministic grid and the client kicks off the shimmer on mount.
 */

// cx/cy for each of Grip's nine dots (lucide viewBox is 0 0 24 24).
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

type DotAnim = { delay: number; duration: number }

function randomAnim(): DotAnim {
  // Durations spread across ~0.9–1.9s and delays across a full cycle so the
  // nine dots drift permanently out of phase with one another.
  return {
    delay: -Math.random() * 1.9,
    duration: 0.9 + Math.random() * 1,
  }
}

export function GripSpinner({ className }: { className?: string }) {
  const [anims, setAnims] = useState<DotAnim[] | null>(null)

  useEffect(() => {
    setAnims(DOTS.map(() => randomAnim()))
  }, [])

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {DOTS.map(([cx, cy], i) => {
        const anim = anims?.[i]
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={1}
            style={
              anim
                ? {
                    animation: `grip-dot-twinkle ${anim.duration}s ease-in-out ${anim.delay}s infinite`,
                  }
                : undefined
            }
          />
        )
      })}
    </svg>
  )
}
