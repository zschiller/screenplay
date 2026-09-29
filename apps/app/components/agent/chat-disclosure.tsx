"use client"

import type { ComponentProps, ReactNode } from "react"
import { CaretDownIcon } from "@workspace/ui/components/icons"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { cn } from "@workspace/ui/lib/utils"

const HEADER_CLASS =
  "flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground"

/**
 * The one expand/collapse section the chat transcript uses: reasoning, a
 * subagent group, a tool call, and a plan. A bordered block with a header row
 * (icon, title, optional trailing meta, chevron) over a body that sits inside
 * the same border.
 *
 * Built on the Collapsible primitive, so the header is a real button carrying
 * `aria-expanded`/`aria-controls` and shows a focus ring from the keyboard.
 * The body is a sibling of the button, never inside it: WebKit (the desktop
 * app's WKWebView) lays out a max-height-clamped scroller nested in a button at
 * its full content height.
 *
 * A section with nothing to hide passes `collapsible={false}`: the header is
 * then plain text with no chevron, and the body (if any) always shows.
 */
export function ChatDisclosure({
  open = false,
  onOpenChange,
  collapsible = true,
  icon,
  title,
  meta,
  children,
  className,
  headerProps,
}: {
  /** Ignored when not collapsible: its body always shows. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  collapsible?: boolean
  icon: ReactNode
  title: ReactNode
  /** Trailing header content before the chevron, e.g. a count. */
  meta?: ReactNode
  children?: ReactNode
  className?: string
  /** Extra attributes for the header (test ids, data attributes). */
  headerProps?: ComponentProps<"div"> & Record<`data-${string}`, unknown>
}) {
  const header = (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {meta}
      {collapsible && (
        <CaretDownIcon
          aria-hidden
          className="size-3 shrink-0 -rotate-90 transition-transform group-data-[state=open]/disclosure:rotate-0"
        />
      )}
    </>
  )
  const frame = cn("rounded-md border border-border bg-muted/30", className)
  const body = "border-t border-border"

  if (!collapsible) {
    return (
      <div className={frame}>
        <div {...headerProps} className={HEADER_CLASS}>
          {header}
        </div>
        {children != null && <div className={body}>{children}</div>}
      </div>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={frame}>
      <CollapsibleTrigger
        {...(headerProps as ComponentProps<"button">)}
        className={cn(
          HEADER_CLASS,
          "group/disclosure outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset data-[state=open]:rounded-b-none"
        )}
      >
        {header}
      </CollapsibleTrigger>
      <CollapsibleContent className={body}>{children}</CollapsibleContent>
    </Collapsible>
  )
}
