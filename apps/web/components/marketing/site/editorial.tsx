import Image, { type StaticImageData } from "next/image"

import { cn } from "@workspace/ui/lib/utils"

/** The page's measure: one left edge for every section. */
export const measure = "mx-auto w-full max-w-6xl px-5 sm:px-8"

/** Small uppercase Geist Mono, for eyebrows, captions and scene numbers. */
export const monoLabel =
  "font-mono text-[11px] leading-[1.4] font-medium tracking-[0.08em] uppercase"

/** Square-cornered link buttons: solid ink, or a hairline in ink. */
export function buttonClass(
  variant: "solid" | "outline",
  size: "default" | "lg" = "default"
) {
  return cn(
    "focus-visible:outline-selection inline-flex items-center gap-2 rounded-sm border border-foreground font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
    size === "lg" ? "h-12 px-5.5 text-[15px]" : "h-9 px-4 text-sm",
    variant === "solid"
      ? "bg-foreground text-background hover:bg-foreground/85"
      : "hover:bg-muted"
  )
}

/**
 * A real capture of the app, in the theme the page is showing, inside a
 * hairline frame. The images come from the docs screenshot run
 * (apps/app/screenshots/docs/homepage.ts).
 */
export function ProductShot({
  light,
  dark,
  alt,
  sizes,
  priority,
  className,
}: {
  light: StaticImageData
  dark: StaticImageData
  alt: string
  sizes: string
  priority?: boolean
  className?: string
}) {
  const img = "block h-auto w-full"
  return (
    <div className={cn("overflow-hidden border border-border", className)}>
      <Image
        src={light}
        alt={alt}
        sizes={sizes}
        priority={priority}
        className={cn(img, "dark:hidden")}
      />
      <Image
        src={dark}
        alt={alt}
        sizes={sizes}
        priority={priority}
        className={cn(img, "hidden dark:block")}
      />
    </div>
  )
}
