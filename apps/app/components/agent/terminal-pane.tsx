"use client"

import { useEffect, useRef } from "react"
import {
  CaretDownIcon,
  PlusIcon,
  TerminalWindowIcon,
  XIcon,
} from "@workspace/ui/components/icons"
import type { PanelImperativeHandle } from "react-resizable-panels"

import { ButtonGroup } from "@workspace/ui/components/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  EditableText,
  editableTextFieldClass,
} from "@workspace/ui/components/editable-text"
import { IconButton } from "@workspace/ui/components/icon-button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"

import { useAppSession } from "@/lib/auth-client"
import {
  DEFAULT_HARNESS_KEY,
  readLastHarnessKey,
  writeLastHarnessKey,
  writeLastTabKind,
} from "@/lib/canvas/tab-kind"
import {
  isTerminalPaneToggle,
  type PaneTerminal,
} from "@/lib/chat/terminal-pane"
import { useInstalledHarnesses } from "@/hooks/use-installed-harnesses"
import type { BranchData } from "@/lib/types"

import { LogsPanel } from "./logs-panel"
import { TerminalTab } from "./terminal-tab"
import type { TerminalPaneController } from "./use-terminal-pane-controller"
import { useTerminalCloseGuard } from "./use-terminal-close-guard"

const TOGGLE_SHORTCUT = "⌃`"

/**
 * Opening and closing is one motion (#1344): 280ms on the product's tab ease.
 * The footnote is the pane's tab strip at rest, so the same labels, hairlines
 * and controls move rather than one row swapping for another. Font size is
 * animated (not a transform), so labels re-rasterize every frame and stay
 * crisp. Reduced motion switches instantly.
 */
const MOTION_MS = 280
const MOTION =
  "duration-280 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"

/** The closed pane's height: the footnote under the composer. */
const FOOTNOTE_PX = 28

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  )
}

/**
 * The dev server's state dot. Green while the Workspace's Sandbox is running,
 * red when it failed, muted otherwise (booting, stopped).
 */
function DevServerDot({ status }: { status: BranchData["status"] }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status === "running"
          ? "bg-success-fill"
          : status === "error"
            ? "bg-destructive-fill"
            : "bg-muted-foreground/50"
      )}
    />
  )
}

/**
 * The Terminal Pane (#1341, spec #1340): a stock vertical Resizable under a
 * Workspace's chat. Closed, it is a borderless footnote under the composer
 * naming the Workspace's terminals; clicking a name opens the pane on it.
 * Open, the footnote becomes a line tab strip — Dev server first, then this
 * person's shells and +, and a hide caret at the right. ⌃` toggles it, and
 * dragging the divider to the bottom closes it. Height and open/closed come
 * from the person's pref (`useTerminalPaneController`), the same in every
 * Workspace.
 */
export function TerminalPane({
  pane,
  agent,
  roomId,
  onCreateShell,
  onRenameShell,
  onCloseShell,
  children,
}: {
  pane: TerminalPaneController
  agent: BranchData
  roomId: string
  /** Open a Terminal Tab launching `harnessKey`; returns its id. Absent where
   *  shells can't be opened (the player), which hides +. */
  onCreateShell?: (harnessKey: string) => string
  onRenameShell?: (id: string, label: string) => void
  onCloseShell?: (id: string) => void
  /** The Workspace's chat, above the pane. */
  children: React.ReactNode
}) {
  const panelRef = useRef<PanelImperativeHandle | null>(null)
  const { open, size, selectedId, terminals } = pane

  // The pref drives the panel: opening expands it to the remembered height,
  // closing collapses it. A drag that changes it lands back in the pref
  // through `onLayoutChanged` below, so the two can't disagree for long.
  // Every trigger (a name, the caret, ⌃`, Open logs) lands here, so the
  // panels' flex-grow eases for exactly these changes and never for a drag.
  const sizeRef = useRef(size)
  useEffect(() => {
    sizeRef.current = size
  }, [size])
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const opening = open && panel.isCollapsed()
    const closing = !open && !panel.isCollapsed()
    if (!opening && !closing) return
    const root = rootRef.current
    const animate = !!root && !prefersReducedMotion()
    if (animate) root.dataset.animating = ""
    if (opening) {
      // Straight to the remembered height: expand() first would aim the
      // motion at the last dragged size and then retarget it mid-flight.
      panel.resize(`${sizeRef.current}%`)
    } else {
      panel.collapse()
    }
    if (!animate) return
    const timer = window.setTimeout(() => {
      delete root.dataset.animating
    }, MOTION_MS)
    return () => {
      window.clearTimeout(timer)
      delete root.dataset.animating
    }
  }, [open])

  // ⌃` opens and closes the pane from anywhere while a Workspace is shown,
  // including from inside a shell (capture, so xterm never sees it).
  const toggle = pane.toggle
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTerminalPaneToggle(e)) return
      e.preventDefault()
      e.stopPropagation()
      toggle()
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [toggle])

  // A shell's × asks first when it's running something, then selection falls
  // to its neighbour before the tab goes.
  const shellClosing = pane.shellClosing
  const closeGuard = useTerminalCloseGuard({
    roomId,
    agent,
    onClose: (id) => {
      shellClosing(id)
      onCloseShell?.(id)
    },
  })

  const isAgentBusy = agent.status === "creating" || agent.status === "starting"

  return (
    <div ref={rootRef} className="group/pane-root flex min-h-0 flex-1 flex-col">
      <ResizablePanelGroup
        orientation="vertical"
        className="min-h-0 flex-1 group-data-animating/pane-root:[&>[data-panel]]:transition-[flex-grow] group-data-animating/pane-root:[&>[data-panel]]:duration-280 group-data-animating/pane-root:[&>[data-panel]]:ease-[cubic-bezier(0.16,1,0.3,1)]"
        defaultLayout={{
          chat: open ? 100 - size : 100,
          terminal: open ? size : 0,
        }}
        onLayoutChanged={(layout, meta) => {
          if (!meta.isUserInteraction) return
          if (panelRef.current?.isCollapsed()) {
            pane.setOpen(false)
          } else {
            pane.setSize(Math.round((layout.terminal ?? 0) * 10) / 10)
            pane.setOpen(true)
          }
        }}
      >
        <ResizablePanel id="chat" minSize="160px">
          <div className="flex h-full flex-col">{children}</div>
        </ResizablePanel>
        <ResizableHandle
          disabled={!open}
          className={cn(
            "transition-colors focus-visible:ring-0",
            MOTION,
            !open && "bg-transparent"
          )}
        />
        {/* Collapsed, the pane is just its bar: the footnote. */}
        <ResizablePanel
          id="terminal"
          panelRef={panelRef}
          minSize="120px"
          collapsible
          collapsedSize={`${FOOTNOTE_PX}px`}
        >
          <Tabs
            value={selectedId}
            onValueChange={pane.select}
            data-pane={open ? "open" : "closed"}
            className="flex h-full flex-col gap-0 bg-background"
          >
            <div
              className={cn(
                "flex shrink-0 items-stretch border-b transition-[height,border-color]",
                MOTION,
                open ? "h-10 border-border" : "h-7 border-transparent"
              )}
            >
              <TabsList
                variant="line"
                aria-label="Terminals"
                className="min-w-0 flex-1 items-stretch gap-0 p-0 group-data-horizontal/tabs:h-full"
              >
                <ScrollArea
                  orientation="horizontal"
                  className="min-w-0 flex-1 [&_[data-slot=scroll-area-scrollbar]]:hidden"
                >
                  <div
                    className={cn(
                      "flex h-full w-max items-center pr-2 transition-[padding,gap]",
                      MOTION,
                      open ? "gap-1 py-[3px] pl-[11px]" : "gap-0.5 pl-1"
                    )}
                  >
                    {terminals.map((terminal, i) => (
                      <PaneTab
                        key={terminal.id}
                        terminal={terminal}
                        agent={agent}
                        open={open}
                        selected={terminal.id === selectedId}
                        title={
                          !open && i === 0
                            ? `Open terminal (${TOGGLE_SHORTCUT})`
                            : undefined
                        }
                        onOpen={() => pane.openOn(terminal.id)}
                        onRename={(label) =>
                          onRenameShell?.(terminal.id, label)
                        }
                        onClose={
                          terminal.kind === "shell"
                            ? () =>
                                void closeGuard.requestClose(terminal.terminal)
                            : undefined
                        }
                      />
                    ))}
                    {onCreateShell && (
                      <FadeUp open={open}>
                        <NewShellButton
                          disabled={isAgentBusy}
                          onCreate={(harnessKey) =>
                            pane.openOn(onCreateShell(harnessKey))
                          }
                        />
                      </FadeUp>
                    )}
                  </div>
                </ScrollArea>
              </TabsList>
              <FadeUp
                open={open}
                className="flex shrink-0 items-center pr-3 pl-1"
              >
                <IconButton
                  label="Hide terminal"
                  shortcut={TOGGLE_SHORTCUT}
                  className="text-muted-foreground"
                  onClick={() => pane.setOpen(false)}
                >
                  <CaretDownIcon />
                </IconButton>
              </FadeUp>
            </div>
            {/* The output follows 80ms behind the bar on the way in, and
                leaves first on the way out. */}
            <div
              inert={!open}
              className={cn(
                "flex min-h-0 flex-1 flex-col transition-opacity",
                MOTION,
                open ? "opacity-100 delay-80" : "opacity-0"
              )}
            >
              {terminals.map((terminal) => (
                <TabsContent
                  key={terminal.id}
                  value={terminal.id}
                  className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
                  forceMount
                >
                  {terminal.kind === "dev-server" ? (
                    <LogsPanel sandboxName={agent.sandboxName} />
                  ) : (
                    // A shell renders the in-sandbox web terminal; its
                    // scrollback never enters the conversation model.
                    <TerminalTab
                      sessionId={terminal.terminal.terminalSessionId}
                      roomId={roomId}
                      sandboxName={agent.sandboxName}
                      sandboxStatus={agent.status}
                      harnessKey={terminal.terminal.harnessKey}
                    />
                  )}
                </TabsContent>
              ))}
            </div>
          </Tabs>
        </ResizablePanel>
      </ResizablePanelGroup>
      {closeGuard.dialog}
    </div>
  )
}

/**
 * The open bar's controls (+, the hide caret): faded down and out of the tab
 * order while the pane is a footnote, fading up as it opens.
 */
function FadeUp({
  open,
  className,
  children,
}: {
  open: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      inert={!open}
      className={cn(
        "transition-[opacity,translate]",
        MOTION,
        open ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
        className
      )}
    >
      {children}
    </div>
  )
}

// A shell tab's inline-rename field: the geometry is reserved in both modes so
// entering edit mode only paints, never shifts the tab.
const TAB_LABEL_CLASS =
  "max-w-[180px] min-w-0 rounded-xs px-0.5 py-0.5 -mx-0.5 -my-0.5"

/**
 * One terminal's tab. Closed, it rests as a muted 12px footnote name and
 * clicking it opens the pane on it; open, it's a 14px line tab whose selection
 * takes the underline.
 */
function PaneTab({
  terminal,
  agent,
  open,
  selected,
  title,
  onOpen,
  onRename,
  onClose,
}: {
  terminal: PaneTerminal
  agent: BranchData
  open: boolean
  selected: boolean
  title?: string
  onOpen: () => void
  onRename: (label: string) => void
  /** Absent for Dev server, which never closes. */
  onClose?: () => void
}) {
  return (
    <div
      data-tab-id={terminal.id}
      className="group/tab relative flex h-full shrink-0 items-stretch"
    >
      {/* A shell keeps room for its hover close, so the × never covers a
          short label. */}
      <TabsTrigger
        value={terminal.id}
        title={title}
        onClick={open ? undefined : onOpen}
        className={cn(
          "px-2 py-1 after:duration-280 after:ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:after:transition-none",
          MOTION,
          open
            ? cn("text-sm", terminal.kind === "shell" && "min-w-[100px]")
            : "min-w-0 text-xs font-normal data-active:text-muted-foreground group-data-[variant=line]/tabs-list:data-active:after:opacity-0 dark:data-active:text-muted-foreground"
        )}
      >
        {terminal.kind === "dev-server" ? (
          <span className="flex items-center gap-1.5">
            <DevServerDot status={agent.status} />
            {terminal.label}
          </span>
        ) : (
          <EditableText
            as="span"
            value={terminal.label}
            onCommit={onRename}
            disabled={!open}
            placeholder="Untitled"
            className={TAB_LABEL_CLASS}
            viewClassName="truncate"
            editClassName={editableTextFieldClass}
          />
        )}
      </TabsTrigger>
      {/* Beside the trigger, not inside it (a button can't nest in one).
          Shows on hover and on keyboard focus; only the selected tab's close
          is a Tab stop. */}
      {onClose && open && (
        <div className="absolute top-0 right-0 bottom-0 flex items-center bg-[var(--background)] pr-0.5 opacity-0 transition-opacity group-hover/tab:opacity-100 focus-within:opacity-100">
          <div className="pointer-events-none absolute inset-y-0 -left-4 w-4 bg-gradient-to-r from-transparent to-[var(--background)]" />
          <IconButton
            label="Close terminal"
            className="relative text-muted-foreground"
            tabIndex={selected ? 0 : -1}
            onClick={onClose}
          >
            <XIcon />
          </IconButton>
        </div>
      )}
    </div>
  )
}

/**
 * + opens a terminal with the person's last harness; the caret beside it picks
 * another when several are installed.
 */
function NewShellButton({
  disabled,
  onCreate,
}: {
  disabled: boolean
  onCreate: (harnessKey: string) => void
}) {
  const { data: session } = useAppSession()
  const userId = session?.user.id
  const installedHarnesses = useInstalledHarnesses(true)
  // The harness "+" repeats: the person's last pick if it's still installed,
  // else the first installed, else the catalog default. A hint only; a tab's
  // harness lives on its row.
  const stored = userId ? readLastHarnessKey(userId) : null
  const defaultHarnessKey =
    stored && installedHarnesses.some((h) => h.key === stored)
      ? stored
      : (installedHarnesses[0]?.key ?? DEFAULT_HARNESS_KEY)

  const create = (harnessKey: string) => {
    writeLastTabKind("terminal")
    if (userId) writeLastHarnessKey(userId, harnessKey)
    onCreate(harnessKey)
  }

  return (
    <ButtonGroup className={`${disabled ? "" : "group/newtab"} ml-1 shrink-0`}>
      <IconButton
        label="New terminal"
        hint={disabled ? "Sandbox still starting…" : undefined}
        className="group-hover/newtab:bg-muted group-hover/newtab:text-foreground group-has-[[aria-expanded=true]]/newtab:bg-muted group-has-[[aria-expanded=true]]/newtab:text-foreground in-data-[slot=button-group]:rounded-md dark:group-hover/newtab:bg-muted/50 dark:group-has-[[aria-expanded=true]]/newtab:bg-muted/50"
        onClick={() => create(defaultHarnessKey)}
        disabled={disabled}
      >
        <PlusIcon />
      </IconButton>
      {installedHarnesses.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              label="New terminal with…"
              className="w-4 min-w-0 px-0 opacity-0 group-focus-within/newtab:opacity-100 group-hover/newtab:bg-muted group-hover/newtab:text-foreground group-hover/newtab:opacity-100 group-has-[[aria-expanded=true]]/newtab:bg-muted group-has-[[aria-expanded=true]]/newtab:text-foreground in-data-[slot=button-group]:rounded-md aria-expanded:opacity-100 dark:group-hover/newtab:bg-muted/50 dark:group-has-[[aria-expanded=true]]/newtab:bg-muted/50"
              disabled={disabled}
            >
              <CaretDownIcon />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>New terminal</DropdownMenuLabel>
            {installedHarnesses.map((h) => (
              <DropdownMenuItem key={h.key} onSelect={() => create(h.key)}>
                <TerminalWindowIcon className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{h.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </ButtonGroup>
  )
}
