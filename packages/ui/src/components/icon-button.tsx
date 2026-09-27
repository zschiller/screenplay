"use client"

import * as React from "react"
import { Slot } from "radix-ui"

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
  /**
   * Extra tooltip lines under the label (e.g. why the button is disabled, or a
   * secondary shortcut). The accessible name stays `label` alone.
   */
  hint?: React.ReactNode
  /**
   * Render the single child as the button instead of a `Button`, so a surface
   * with its own button primitive (`SidebarMenuAction`, `InputGroupButton`)
   * keeps its styling and still gets the label and tooltip.
   */
  asChild?: boolean
}

/**
 * An icon-only button that can't be rendered without a label: the label is
 * both its accessible name and its styled tooltip, with an optional shortcut
 * hint. Forwards every other prop (and `ref`) to the underlying `Button`, so it
 * composes under Radix `asChild` triggers (`DropdownMenuTrigger`,
 * `PopoverTrigger`) the same way a bare `Button` does.
 *
 * A disabled button fires no pointer events, so while `disabled` the tooltip
 * hangs off a wrapping span instead: the label (and `hint`, which is where to
 * say why) still shows on hover.
 *
 * Carries its own `TooltipProvider`, so it works anywhere without a provider
 * ancestor.
 */
function IconButton({
  label,
  shortcut,
  pressed,
  tooltipSide = "top",
  hint,
  asChild = false,
  variant = "ghost",
  size = "icon-xs",
  ...props
}: IconButtonProps) {
  const button = asChild ? (
    <Slot.Root aria-label={label} aria-pressed={pressed} {...props} />
  ) : (
    <Button
      variant={variant}
      size={size}
      aria-label={label}
      aria-pressed={pressed}
      {...props}
    />
  )
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {props.disabled ? (
            <span className="inline-flex">{button}</span>
          ) : (
            button
          )}
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>
          {hint ? (
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5">
                {label}
                {shortcut ? <Kbd>{shortcut}</Kbd> : null}
              </span>
              <span className="opacity-70">{hint}</span>
            </span>
          ) : (
            <>
              {label}
              {shortcut ? <Kbd>{shortcut}</Kbd> : null}
            </>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { IconButton, type IconButtonProps }
