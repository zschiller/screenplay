"use client"

import { useEffect, useRef, useState } from "react"
import {
  CaretDownIcon,
  PlayIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "@workspace/ui/components/icons"
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
  paneCloseFallback,
  type PaneTerminal,
} from "@/lib/chat/terminal-pane"
import {
  canControlDevServer,
  resolveDevServerState,
  type DevServerState,
} from "@/lib/sandbox/dev-server-state"
import { usePreviewFailing } from "@/hooks/use-preview-failing"
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

/**
 * The closed pane's height: the footnote, tucked up under the composer (whose
 * bottom padding shrinks to 4px while the pane is closed) with room below it.
 */
const FOOTNOTE_PX = 36

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  )
}

/**
 * The dev server's state dot (#1342): green while it runs, red when it crashed
 * (or the Workspace failed), muted while it's stopped or still starting.
 */
function DevServerDot({ state }: { state: DevServerState }) {
  return (
    <span
      aria-hidden
      data-dev-server-state={state}
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        state === "running"
          ? "bg-success-fill"
          : state === "crashed"
            ? "bg-destructive-fill"
            : "bg-muted-foreground/50"
      )}
    />
  )
}

/** Run and Stop for a Workspace's dev server, by Branch id (#1342). */
export interface DevServerControls {
  stop: (branchId: string) => Promise<void>
  run: (branchId: string) => Promise<void>
}

/**
 * The dev server's state and its verbs for one Workspace. A click disables
 * the buttons until its action settles, so a slow launch can't be doubled.
 */
function useDevServer(agent: BranchData, controls?: DevServerControls) {
  const controllable = canControlDevServer(agent)
  const failing = usePreviewFailing(
    agent.previewDomain || undefined,
    controllable && !agent.devServerStoppedAt,
    agent.devServerLaunchedAt
  )
  const state = resolveDevServerState(agent, failing)
  const [pending, setPending] = useState(false)
  const act = (fn?: (branchId: string) => Promise<void>) =>
    fn && controllable
      ? () => {
          setPending(true)
          void fn(agent.id).finally(() => setPending(false))
        }
      : undefined
  return {
    state,
    pending,
    stop: act(controls?.stop),
    run: act(controls?.run),
  }
}

type DevServer = ReturnType<typeof useDevServer>

/**
 * Stop while the dev server runs, Run while it's stopped or crashed (Run
 * relaunches it). Absent while the Sandbox itself isn't running, or where
 * there are no controls.
 */
function StopOrRunButton({ devServer }: { devServer: DevServer }) {
  const { state, pending, stop, run } = devServer
  const running = state === "running"
  const action = running ? stop : state === "starting" ? undefined : run
  if (!action) return null
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="font-normal text-muted-foreground"
      disabled={pending}
      onClick={action}
    >
      {running ? <SquareIcon /> : <PlayIcon />}
      {running ? "Stop" : "Run"}
    </Button>
  )
}

/**
 * The Terminal Pane (#1341, spec #1340): a stock vertical Resizable under a
 * Workspace's chat. Closed, it is a borderless footnote under the composer
 * naming the Workspace's terminals; clicking a name opens the pane on it.
 * Open, the footnote becomes a line tab strip — Dev server first, then this
 * person's shells and +, and a hide caret at the right. The dev server's Stop
 * or Run (#1342) sits at the right in both. ⌃` toggles it, and
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
  devServer: devServerControls,
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
  /** Run and Stop (#1342). Absent where the dev server can't be
   *  controlled (the player), which hides the buttons. */
  devServer?: DevServerControls
  /** The Workspace's chat, above the pane. */
  children: React.ReactNode
}) {
  const panelRef = useRef<PanelImperativeHandle | null>(null)
  const { open, size, selectedId, terminals } = pane
  const devServer = useDevServer(agent, devServerControls)

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
  // to its neighbour before the tab goes. Focus follows it there: the × it was
  // on is gone, and the browser would drop it to the page.
  const shellClosing = pane.shellClosing
  const closeGuard = useTerminalCloseGuard({
    roomId,
    agent,
    onClose: (id) => {
      const next =
        selectedId === id ? paneCloseFallback(terminals, id) : selectedId
      shellClosing(id)
      onCloseShell?.(id)
      // Next frame, once the tab is gone. Focus elsewhere (the close dialog
      // aside) moved on purpose, so leave it.
      requestAnimationFrame(() => {
        const root = rootRef.current
        const active = document.activeElement
        if (
          !root ||
          (active &&
            active !== document.body &&
            !root.contains(active) &&
            !active.closest("[role=alertdialog]"))
        )
          return
        root
          .querySelector<HTMLElement>(
            `[data-tab-id="${CSS.escape(next)}"] [role="tab"]`
          )
          ?.focus()
      })
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
          {/* Closed, the composer gives up most of its bottom padding so the
              footnote sits right under it, as in the mockup. */}
          <div
            className={cn(
              "flex h-full flex-col [&_[data-slot=composer]]:transition-[padding] [&_[data-slot=composer]]:duration-280 [&_[data-slot=composer]]:ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:[&_[data-slot=composer]]:transition-none",
              !open && "[&_[data-slot=composer]]:pb-1"
            )}
          >
            {children}
          </div>
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
                open ? "h-10 border-border" : "h-9 border-transparent"
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
                      "flex w-max items-center pr-2 transition-[height,padding,gap]",
                      MOTION,
                      open
                        ? "h-10 gap-1 py-[3px] pl-[11px]"
                        : "h-6 gap-0.5 pl-1"
                    )}
                  >
                    {terminals.map((terminal, i) => (
                      <PaneTab
                        key={terminal.id}
                        terminal={terminal}
                        devServerState={devServer.state}
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
                          onCreate={() => pane.openOn(onCreateShell())}
                        />
                      </FadeUp>
                    )}
                  </div>
                </ScrollArea>
              </TabsList>
              {/* Closed, this row matches the footnote names' 24px line. */}
              <div
                className={cn(
                  "flex shrink-0 items-center gap-0.5 self-start pr-3 pl-1 transition-[height]",
                  MOTION,
                  open ? "h-10" : "h-6"
                )}
              >
                {/* Stop or Run shows in both modes (#1342); closed, it slides
                    into the hidden caret's place at the right edge. */}
                <div
                  className={cn(
                    "transition-[translate]",
                    MOTION,
                    open ? "translate-x-0" : "translate-x-[30px]"
                  )}
                >
                  <StopOrRunButton devServer={devServer} />
                </div>
                <FadeUp open={open}>
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
  devServerState,
  open,
  selected,
  title,
  onOpen,
  onRename,
  onClose,
}: {
  terminal: PaneTerminal
  devServerState: DevServerState
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
            : "min-w-0 text-sm font-normal data-active:text-muted-foreground group-data-[variant=line]/tabs-list:data-active:after:opacity-0 dark:data-active:text-muted-foreground"
        )}
      >
        {terminal.kind === "dev-server" ? (
          <span className="flex items-center gap-1.5">
            <DevServerDot state={devServerState} />
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
      label="New terminal"
      hint={disabled ? "Still setting up the code…" : undefined}
      className="ml-1 shrink-0"
      onClick={onCreate}
      disabled={disabled}
    >
      <PlusIcon />
    </IconButton>
  )
}
