"use client"

import * as React from "react"

import { IconButton } from "@workspace/ui/components/icon-button"
import { cn } from "@workspace/ui/lib/utils"

type Orientation = "horizontal" | "vertical"

const OrientationContext = React.createContext<Orientation>("horizontal")

/**
 * The floating pill that holds the canvas chrome's buttons: the bottom tool
 * toolbar, the top bar, a selected frame's toolbar, and a Document's formatting
 * bubble all share this one shell, so they read as one product.
 *
 * Only the shell: positioning (portals, absolute offsets) stays with the caller.
 */
function FloatingToolbar({
  orientation = "horizontal",
  className,
  ...props
}: React.ComponentProps<"div"> & { orientation?: Orientation }) {
  return (
    <OrientationContext.Provider value={orientation}>
      <div
        role="toolbar"
        aria-orientation={orientation}
        data-slot="floating-toolbar"
        className={cn(
          "pointer-events-auto flex items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/5",
          orientation === "vertical" && "flex-col",
          className
        )}
        {...props}
      />
    </OrientationContext.Provider>
  )
}

/** A hairline between button groups, running across the toolbar's axis. */
function FloatingToolbarSeparator({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const orientation = React.useContext(OrientationContext)
  return (
    <div
      role="separator"
      aria-orientation={
        orientation === "horizontal" ? "vertical" : "horizontal"
      }
      data-slot="floating-toolbar-separator"
      className={cn(
        "shrink-0 bg-foreground/10",
        orientation === "horizontal" ? "mx-0.5 h-4 w-px" : "my-0.5 h-px w-full",
        className
      )}
      {...props}
    />
  )
}

/**
 * A labelled icon button for a {@link FloatingToolbar}. Pass `pressed` to make
 * it a toggle: it exposes `aria-pressed` and fills while on, the same way the
 * tool modes do. Its tooltip opens away from the toolbar unless told otherwise.
 */
function FloatingToolbarButton({
  pressed,
  variant,
  tooltipSide,
  ...props
}: React.ComponentProps<typeof IconButton>) {
  const orientation = React.useContext(OrientationContext)
  return (
    <IconButton
      pressed={pressed}
      variant={variant ?? (pressed ? "default" : "ghost")}
      tooltipSide={
        tooltipSide ?? (orientation === "vertical" ? "right" : "top")
      }
      {...props}
    />
  )
}

export { FloatingToolbar, FloatingToolbarButton, FloatingToolbarSeparator }
