import type { SVGProps } from "react"
import { ScreenplayMark } from "@workspace/ui/components/screenplay-mark"
import { cn } from "@workspace/ui/lib/utils"

/**
 * The Screenplay mark on the app's entry screens. The brand blue lifts a step
 * on a dark background so the screen keeps its edge; the navy face reads as a
 * cut-out in both themes. Size it with `className` (`size-8` by default).
 */

export function ScreenplayLogo({
  className,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <ScreenplayMark
      className={cn("size-8 shrink-0", className)}
      bodyClassName="dark:fill-[#3B8CF5]"
      {...props}
    />
  )
}
