"use client"

import { ChevronDown, Plus, SquareTerminal, X } from "lucide-react"

import { ButtonGroup } from "@workspace/ui/components/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { EditableText } from "@workspace/ui/components/editable-text"
import { IconButton } from "@workspace/ui/components/icon-button"
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd"
import { cn } from "@workspace/ui/lib/utils"

import type { InstalledHarness } from "@/hooks/use-installed-harnesses"
import type { SandboxStatus, TerminalTabData } from "@/lib/types"
import { TAB_LABEL_CLASS, TAB_LABEL_EDIT_CLASS } from "./tab-label"
import { TerminalTab } from "./terminal-tab"

/** The drawer's toggle, as one Kbd per key. */
function ToggleKbd() {
  return (
    <KbdGroup>
      <Kbd>⌃</Kbd>
      <Kbd>`</Kbd>
    </KbdGroup>
  )
}

/**
 * The terminal drawer under the chat composer. Terminals are ephemeral shells,
 * not conversations, so they sit apart from the chat tabs: collapsed, the drawer
 * is one row with a count; open, it has its own tab row and the live terminals.
 *
 * Every terminal stays mounted while the drawer is collapsed or another terminal
 * is showing, so its PTY connection and scrollback survive.
 */
export function TerminalDrawer({
  terminals,
  open,
  onToggle,
  activeId,
  onActiveChange,
  onClose,
  onRename,
  onCreate,
  harnesses,
  defaultHarnessKey,
  disabled,
  roomId,
  sandboxName,
  sandboxStatus,
}: {
  terminals: TerminalTabData[]
  open: boolean
  /** Open or collapse the drawer; opening an empty drawer starts a terminal. */
  onToggle: () => void
  activeId: string | null
  onActiveChange: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, label: string) => void
  onCreate: (harnessKey: string) => void
  harnesses: InstalledHarness[]
  defaultHarnessKey: string
  /** The sandbox is still starting, so nothing can be launched yet. */
  disabled?: boolean
  roomId: string
  sandboxName?: string
  sandboxStatus?: SandboxStatus
}) {
  return (
    <div
      data-state={open ? "open" : "closed"}
      className={cn(
        "flex shrink-0 flex-col border-t border-border bg-background",
        open && "h-[45%] min-h-40"
      )}
    >
      {open ? (
        <div className="flex h-8 shrink-0 items-center gap-1 px-2">
          <div
            role="tablist"
            aria-label="Terminals"
            className="flex h-full min-w-0 flex-1 items-stretch gap-1 overflow-hidden"
          >
            {terminals.map((t) => (
              <TerminalTabButton
                key={t.id}
                terminal={t}
                active={t.id === activeId}
                onSelect={() => onActiveChange(t.id)}
                onClose={() => onClose(t.id)}
                onRename={(label) => onRename(t.id, label)}
              />
            ))}
          </div>
          <NewTerminalButton
            harnesses={harnesses}
            defaultHarnessKey={defaultHarnessKey}
            onCreate={onCreate}
            disabled={disabled}
          />
          <IconButton
            label="Hide terminal"
            shortcut="⌃`"
            className="shrink-0 text-muted-foreground"
            onClick={onToggle}
          >
            <ChevronDown className="size-3" />
          </IconButton>
        </div>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled && terminals.length === 0}
          aria-expanded={false}
          className="flex h-8 shrink-0 items-center gap-1.5 px-3 text-xs text-muted-foreground outline-none hover:bg-accent/50 hover:text-foreground focus-visible:bg-accent/50 disabled:opacity-50"
        >
          <SquareTerminal className="size-3" />
          Terminal
          {terminals.length > 0 && (
            <span className="rounded-sm bg-muted px-1 text-[11px] leading-4 tabular-nums">
              {terminals.length}
            </span>
          )}
          <span className="ml-auto">
            <ToggleKbd />
          </span>
        </button>
      )}
      <div className={cn("relative min-h-0 flex-1", !open && "hidden")}>
        {terminals.map((t) => (
          <div
            key={t.id}
            role="tabpanel"
            className={cn("absolute inset-0", t.id !== activeId && "invisible")}
          >
            <TerminalTab
              sessionId={t.terminalSessionId}
              roomId={roomId}
              sandboxName={sandboxName}
              sandboxStatus={sandboxStatus}
              harnessKey={t.harnessKey}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function TerminalTabButton({
  terminal,
  active,
  onSelect,
  onClose,
  onRename,
}: {
  terminal: TerminalTabData
  active: boolean
  onSelect: () => void
  onClose: () => void
  onRename: (label: string) => void
}) {
  return (
    <div
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "group/tab relative flex min-w-0 shrink-0 cursor-default items-center gap-1.5 px-1.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground",
        "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground after:opacity-0",
        active && "text-foreground after:opacity-100"
      )}
    >
      <EditableText
        as="span"
        value={terminal.label}
        onCommit={onRename}
        placeholder="Untitled"
        className={cn(TAB_LABEL_CLASS, "font-mono text-xs")}
        viewClassName="truncate"
        editClassName={TAB_LABEL_EDIT_CLASS}
      />
      <IconButton
        label="Close terminal"
        size="icon-xxs"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="text-muted-foreground opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100"
      >
        <X className="size-3" />
      </IconButton>
    </div>
  )
}

/**
 * New terminal. With one harness (or none listed yet) it's a plain button; with
 * several, a caret beside it picks which one the terminal launches.
 */
function NewTerminalButton({
  harnesses,
  defaultHarnessKey,
  onCreate,
  disabled,
}: {
  harnesses: InstalledHarness[]
  defaultHarnessKey: string
  onCreate: (harnessKey: string) => void
  disabled?: boolean
}) {
  const plus = (
    <IconButton
      label="New terminal"
      hint={disabled ? "Sandbox still starting…" : undefined}
      className="shrink-0 text-muted-foreground"
      disabled={disabled}
      onClick={() => onCreate(defaultHarnessKey)}
    >
      <Plus className="size-3" />
    </IconButton>
  )
  if (harnesses.length <= 1) return plus
  return (
    <ButtonGroup className="shrink-0">
      {plus}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label="Choose a harness"
            className="w-4 min-w-0 px-0 text-muted-foreground"
            disabled={disabled}
          >
            <ChevronDown className="size-3" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
            New terminal
          </DropdownMenuLabel>
          {harnesses.map((h) => (
            <DropdownMenuItem key={h.key} onSelect={() => onCreate(h.key)}>
              <SquareTerminal className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{h.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}
