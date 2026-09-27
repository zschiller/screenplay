"use client"

import * as React from "react"

import { Button } from "@workspace/ui/components/button"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

type IconButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "aria-label" | "title"
> & {
  /**
   * Required. Used as the button's accessible name (`aria-label`) and as the
   * text of its styled tooltip, so the two can never drift apart.
   */
  label: string
  /** Optional keyboard-shortcut hint rendered as a `Kbd` inside the tooltip. */
  shortcut?: string
  /**
   * For toggle-style buttons (e.g. tool modes): exposes the on/off state to
   * assistive technology as `aria-pressed`. Leave undefined for plain actions.
   */
  pressed?: boolean
  /** Which side of the button the tooltip opens on. */
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"]
}

/**
 * An icon-only button that can't be rendered without a label: the label is
 * both its accessible name and its styled tooltip, with an optional shortcut
 * hint. Forwards every other prop (and `ref`) to the underlying `Button`, so it
 * composes under Radix `asChild` triggers (`DropdownMenuTrigger`,
 * `PopoverTrigger`) the same way a bare `Button` does.
 *
 * Carries its own `TooltipProvider`, so it works anywhere without a provider
 * ancestor.
 */
function IconButton({
  label,
  shortcut,
  pressed,
  tooltipSide = "top",
  variant = "ghost",
  size = "icon-xs",
  ...props
}: IconButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={variant}
            size={size}
            aria-label={label}
            aria-pressed={pressed}
            {...props}
          />
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>
          {label}
          {shortcut ? <Kbd>{shortcut}</Kbd> : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { IconButton, type IconButtonProps }
