import { cn } from "@workspace/ui/lib/utils"

// `font-sans`, not `system-ui`: on Linux Chromium system-ui is a monospaced
// face. Symbols (⌘ ⇧ ⌫) still fall back per glyph.
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-foreground/15 in-data-[slot=tooltip-content]:text-foreground in-[[data-slot=button][data-variant=default]]:bg-primary-foreground/20 in-[[data-slot=button][data-variant=default]]:text-primary-foreground dark:in-[[data-slot=button][data-variant=default]]:bg-primary-foreground/10 [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
