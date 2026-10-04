import { cn } from "@workspace/ui/lib/utils"

import { Fit } from "./fit"

/*
 * The card the "How it works" excerpts sit in (make.tsx): one piece of the
 * app, laid out at the app's real size in a 320×256 card and scaled to the
 * column, and the shared floating surface for menus over it.
 */

export function Card({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Fit
      width={320}
      height={256}
      role="img"
      aria-label={label}
      className={cn("bg-plane border border-border text-foreground", className)}
    >
      <div className="[container-type:inline-size] relative size-full">
        {children}
      </div>
    </Fit>
  )
}

/** A popover or dialog surface, as the app draws one, on the lifted fill. */
export const surface =
  "rounded-lg bg-lift text-popover-foreground shadow-md outline outline-1 outline-foreground/15"
