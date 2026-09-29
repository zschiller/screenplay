import type { SVGProps } from "react"

import {
  MARK_BLUE,
  MARK_BODY,
  MARK_LEFT_EYE,
  MARK_NAVY,
  MARK_RIGHT_EYE,
  MARK_SMILE,
  MARK_SMILE_WIDTH,
} from "@workspace/ui/lib/brand"

/**
 * The static Screenplay mark. Size it with `width`/`height` or `className`.
 * `bodyClassName` lets a surface restyle the screen's fill (a CSS `fill`
 * beats the attribute), e.g. to lift the blue a step on a dark background.
 */
export function ScreenplayMark({
  bodyClassName,
  ...props
}: SVGProps<SVGSVGElement> & { bodyClassName?: string }) {
  return (
    <svg
      width={32}
      height={32}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path d={MARK_BODY} fill={MARK_BLUE} className={bodyClassName} />
      <ellipse {...MARK_LEFT_EYE} fill={MARK_NAVY} />
      <ellipse {...MARK_RIGHT_EYE} fill={MARK_NAVY} />
      <path
        d={MARK_SMILE}
        stroke={MARK_NAVY}
        strokeWidth={MARK_SMILE_WIDTH}
        strokeLinecap="round"
      />
    </svg>
  )
}
