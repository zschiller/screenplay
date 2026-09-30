import { cn } from "@workspace/ui/lib/utils"

/** The page's measure: one left edge for every section. */
export const measure = "mx-auto w-full max-w-6xl px-5 sm:px-8"

/** Small uppercase Geist Mono, for eyebrows, captions and scene numbers. */
export const monoLabel =
  "font-mono text-[11px] leading-[1.4] font-medium tracking-[0.08em] uppercase"

/** The one keyboard focus ring for every link, button and summary. */
export const focusRing =
  "rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-selection focus-visible:outline-solid"

/** Square-cornered link buttons: solid ink, or a hairline in ink. */
export function buttonClass(
  variant: "solid" | "outline",
  size: "default" | "lg" = "default"
) {
  return cn(
    focusRing,
    "inline-flex items-center justify-center gap-2 border border-foreground font-medium whitespace-nowrap transition-colors",
    size === "lg" ? "h-12 px-5.5 text-[15px]" : "h-9 px-4 text-sm",
    variant === "solid"
      ? "bg-foreground text-background hover:bg-foreground/85"
      : "hover:bg-muted"
  )
}
