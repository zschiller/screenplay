"use client"

import { useEffect, useRef } from "react"
import { CaretDownIcon, PlusIcon, XIcon } from "@workspace/ui/components/icons"
import type { PanelImperativeHandle } from "react-resizable-panels"

import { Button } from "@workspace/ui/components/button"
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

import {
  isTerminalPaneToggle,
  type PaneTerminal,
} from "@/lib/chat/terminal-pane"
import type { BranchData } from "@/lib/types"

import { LogsPanel } from "./logs-panel"
import { TerminalTab } from "./terminal-tab"
import type { TerminalPaneController } from "./use-terminal-pane-controller"
import { useTerminalCloseGuard } from "./use-terminal-close-guard"

const TOGGLE_SHORTCUT = "⌃`"

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
  /** Open a shell; returns its id. Absent where shells can't be opened (the
   *  player), which hides +. */
  onCreateShell?: () => string
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
  const sizeRef = useRef(size)
  useEffect(() => {
    sizeRef.current = size
  }, [size])
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    if (open && panel.isCollapsed()) {
      panel.expand()
      panel.resize(`${sizeRef.current}%`)
    } else if (!open && !panel.isCollapsed()) {
      panel.collapse()
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
    <div className="flex min-h-0 flex-1 flex-col">
      <ResizablePanelGroup
        orientation="vertical"
        className="min-h-0 flex-1"
        defaultLayout={{
          chat: open ? 100 - size : 100,
          terminal: open ? size : 0,
        }}
        onLayoutChanged={(layout, meta) => {
          if (!meta.isUserInteraction) return
          const terminal = layout.terminal ?? 0
          if (terminal === 0) {
            pane.setOpen(false)
          } else {
            pane.setSize(Math.round(terminal * 10) / 10)
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
            !open && "opacity-0 aria-[orientation=horizontal]:h-0",
            "focus-visible:ring-0"
          )}
        />
        <ResizablePanel
          id="terminal"
          panelRef={panelRef}
          minSize="120px"
          collapsible
          collapsedSize="0px"
        >
          <Tabs
            value={selectedId}
            onValueChange={pane.select}
            className="flex h-full flex-col gap-0 bg-background"
          >
            <div className="flex h-10 shrink-0 items-stretch border-b border-border">
              <TabsList
                variant="line"
                className="min-w-0 flex-1 items-stretch gap-0 p-0 group-data-horizontal/tabs:h-10"
              >
                <ScrollArea
                  orientation="horizontal"
                  className="min-w-0 flex-1 [&_[data-slot=scroll-area-scrollbar]]:hidden"
                >
                  <div className="flex h-10 w-max items-center gap-1 py-[3px] pr-2 pl-[11px]">
                    {terminals.map((terminal) => (
                      <PaneTab
                        key={terminal.id}
                        terminal={terminal}
                        agent={agent}
                        selected={terminal.id === selectedId}
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
                      <NewShellButton
                        disabled={isAgentBusy}
                        onCreate={() => pane.openOn(onCreateShell())}
                      />
                    )}
                  </div>
                </ScrollArea>
              </TabsList>
              <div className="flex shrink-0 items-center pr-3 pl-1">
                <IconButton
                  label="Hide terminal"
                  shortcut={TOGGLE_SHORTCUT}
                  className="text-muted-foreground"
                  onClick={() => pane.setOpen(false)}
                >
                  <CaretDownIcon />
                </IconButton>
              </div>
            </div>
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
          </Tabs>
        </ResizablePanel>
      </ResizablePanelGroup>
      {!open && (
        <TerminalFootnote
          terminals={terminals}
          agent={agent}
          onOpen={pane.openOn}
        />
      )}
      {closeGuard.dialog}
    </div>
  )
}

/**
 * The closed pane: a quiet line under the composer naming the Workspace's
 * terminals, Dev server first with its dot. Each name opens the pane on it.
 */
function TerminalFootnote({
  terminals,
  agent,
  onOpen,
}: {
  terminals: PaneTerminal[]
  agent: BranchData
  onOpen: (terminalId: string) => void
}) {
  return (
    <nav
      aria-label="Terminals"
      className="flex h-7 shrink-0 items-center gap-0.5 overflow-hidden bg-background px-3 pb-1"
    >
      {terminals.map((terminal, i) => (
        <Button
          key={terminal.id}
          type="button"
          variant="ghost"
          size="xs"
          title={i === 0 ? `Open terminal (${TOGGLE_SHORTCUT})` : undefined}
          className={cn(
            "min-w-0 font-normal text-muted-foreground",
            i === 0 && "-ml-2"
          )}
          onClick={() => onOpen(terminal.id)}
        >
          {terminal.kind === "dev-server" && (
            <DevServerDot status={agent.status} />
          )}
          <span className="truncate">{terminal.label}</span>
        </Button>
      ))}
    </nav>
  )
}

// A shell tab's inline-rename field: the geometry is reserved in both modes so
// entering edit mode only paints, never shifts the tab.
const TAB_LABEL_CLASS =
  "max-w-[180px] min-w-0 rounded-xs px-0.5 py-0.5 -mx-0.5 -my-0.5"

function PaneTab({
  terminal,
  agent,
  selected,
  onRename,
  onClose,
}: {
  terminal: PaneTerminal
  agent: BranchData
  selected: boolean
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
        className={cn(
          "px-2 py-1 text-sm",
          terminal.kind === "shell" && "min-w-[100px]"
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
      {onClose && (
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

/** + opens a plain shell in the Workspace's sandbox (#1343). */
function NewShellButton({
  disabled,
  onCreate,
}: {
  disabled: boolean
  onCreate: () => void
}) {
  return (
    <IconButton
      label="New shell"
      hint={disabled ? "Sandbox still starting…" : undefined}
      className="ml-1 shrink-0"
      onClick={onCreate}
      disabled={disabled}
    >
      <PlusIcon />
    </IconButton>
  )
}
