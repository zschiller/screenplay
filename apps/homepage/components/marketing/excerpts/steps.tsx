import { cn } from "@workspace/ui/lib/utils"

import { edge } from "./canvas"
import { Fit } from "./fit"

/*
 * The card the "How it works" excerpts sit in (make.tsx): one piece of the
 * app, laid out at the app's real size in a 320×256 card and scaled to the
 * column, and the shared floating surface for menus over it.
 */

export function Card({
  label,
  fill,
  className,
  children,
}: {
  label: string
  /** Widen to a wider column rather than centre (see Fit). */
  fill?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <Fit
      width={320}
      height={256}
      fill={fill}
      role="img"
      aria-label={label}
      className={cn("bg-plane text-foreground", className)}
    >
      <div className="[container-type:inline-size] relative size-full">
        {children}
      </div>
    </Fit>
  )
}

/** A popover surface, as the app draws one (PopoverContent). */
export const surface = `rounded-lg bg-popover text-popover-foreground shadow-md ${edge}`
