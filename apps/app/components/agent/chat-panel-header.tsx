"use client"

import { SidebarSimpleIcon } from "@workspace/ui/components/icons"

import { IconButton } from "@workspace/ui/components/icon-button"
import { cn } from "@workspace/ui/lib/utils"

/**
 * The chat panel's 48px header row, led by the Hide chat button (⌘I). Every
 * state of the panel draws this row — a Workspace or document chat, the
 * Coordinator, the no-repository empty state and the player's placeholder — so
 * the button sits in the same spot whatever the panel shows, and a change to
 * Collapse is made here once.
 */
export function ChatPanelHeader({
  onCollapse,
  className,
  children,
}: {
  onCollapse: () => void
  className?: string
  /** What follows the button: the panel's title and its right-hand actions. */
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex h-12 shrink-0 items-center bg-background px-3",
        className
      )}
    >
      <IconButton
        label="Hide chat"
        shortcut="⌘I"
        tooltipSide="left"
        className="mr-1.5 text-muted-foreground"
        onClick={onCollapse}
      >
        <SidebarSimpleIcon mirrored />
      </IconButton>
      {children}
    </div>
  )
}
