"use client"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import { FloatingToolbarButton } from "@workspace/ui/components/floating-toolbar"
import { CursorIcon, MonitorIcon } from "@workspace/ui/components/icons"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@workspace/ui/components/popover"
import { GripSpinner } from "@/components/grip-spinner"
import { presenceInkClass } from "@/lib/canvas/presence-ink"
import type { FrameDriverView, FrameRequesterView } from "./use-frame-control"

/** The agent's name where Frame Control names who drives. */
const AGENT_NAME = "Agent"

/** One initial: all a 16px avatar has room for at the UI text size. */
function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase()
}

/** The driver's mark: the agent's 9 dots, twinkling while it drives, or a
 *  person's avatar in their cursor colour. */
function DriverMark({
  driver,
}: {
  driver: Extract<FrameDriverView, { kind: "agent" | "person" }>
}) {
  if (driver.kind === "agent") return <GripSpinner className="size-4" />
  return <PersonMark person={driver} />
}

/** A person's avatar in their cursor colour. */
function PersonMark({ person }: { person: FrameRequesterView }) {
  return (
    <Avatar className="size-4 after:hidden">
      {person.avatar ? <AvatarImage src={person.avatar} alt="" /> : null}
      <AvatarFallback
        aria-hidden
        style={{ backgroundColor: person.color }}
        className={`text-xs font-medium ${presenceInkClass(person.color)}`}
      >
        {initial(person.name)}
      </AvatarFallback>
    </Avatar>
  )
}

/**
 * The driver's answer to people asking for control (#1395): one row per
 * person, oldest first, each with Not now and Let drive, so simultaneous
 * asks queue and the driver picks one. It hangs under the driver button on
 * the page-theme popover surface, and stays until answered: it doesn't take
 * focus from the frame, and clicking into the page doesn't dismiss it.
 */
function ControlRequests({
  requests,
  onGrant,
  onDecline,
}: {
  requests: readonly FrameRequesterView[]
  onGrant: (id: string) => void
  onDecline: (id: string) => void
}) {
  return (
    <PopoverContent
      side="bottom"
      sideOffset={8}
      aria-label="Requests for control"
      className="w-auto min-w-64 gap-2 p-2"
      onOpenAutoFocus={(e) => e.preventDefault()}
      onInteractOutside={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {requests.map((person) => (
        <div
          key={person.id}
          data-frame-control-request=""
          className="flex items-center gap-2"
        >
          <PersonMark person={person} />
          <span className="min-w-0 flex-1 truncate pr-2">
            {person.name} asks for control
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDecline(person.id)}
          >
            Not now
          </Button>
          <Button size="sm" onClick={() => onGrant(person.id)}>
            Give control
          </Button>
        </div>
      ))}
    </PopoverContent>
  )
}

/**
 * The frame bar's Interact button, which is also the driver button (#1376).
 * Nobody drives, or you do: today's Interact toggle, pressed in the selection
 * fill while you interact. Someone else drives: their mark on the quiet
 * pressed fill, with a two-line tooltip naming who drives and what a click
 * does (takes over from the agent at once, asks the person, or takes your
 * ask back). While you drive and people ask for control, their requests hang
 * under it (#1395).
 */
export function FrameDriverButton({
  driver,
  asked = false,
  requests = [],
  onClick,
  onGrant,
  onDecline,
}: {
  driver: FrameDriverView
  /** You asked the person driving for control. */
  asked?: boolean
  /** People asking you, the driver, for control. */
  requests?: readonly FrameRequesterView[]
  onClick: () => void
  onGrant?: (id: string) => void
  onDecline?: (id: string) => void
}) {
  if (driver.kind === "agent" || driver.kind === "person") {
    const name = driver.kind === "agent" ? AGENT_NAME : driver.name
    return (
      <FloatingToolbarButton
        label={`${name} has control`}
        hint={
          driver.kind === "agent"
            ? "Click to take control"
            : asked
              ? "Asked for control. Click to cancel"
              : "Click to ask for control"
        }
        variant="secondary"
        onClick={onClick}
      >
        <DriverMark driver={driver} />
      </FloatingToolbarButton>
    )
  }
  const you = driver.kind === "you"
  const button = (
    <FloatingToolbarButton
      label="Interact"
      shortcut={you ? ["Esc"] : undefined}
      pressed={you}
      // While interacting, the pressed button takes the selection fill (the
      // hot pink that carries black), like the ring around the frame.
      className={
        you
          ? "bg-canvas-selection-fill text-black hover:bg-canvas-selection-fill/90 hover:text-black dark:hover:bg-canvas-selection-fill/90"
          : undefined
      }
      onClick={onClick}
    >
      <CursorIcon />
    </FloatingToolbarButton>
  )
  const open = you && requests.length > 0 && !!onGrant && !!onDecline
  return (
    <Popover open={open}>
      <PopoverAnchor asChild>{button}</PopoverAnchor>
      {open && (
        <ControlRequests
          requests={requests}
          onGrant={onGrant}
          onDecline={onDecline}
        />
      )}
    </Popover>
  )
}

/**
 * "Agent has control" on the frame's title line, right-aligned to the frame,
 * in the title's type, on the driver's colour: ink for the agent, a person's
 * cursor colour for them. Shown whether or not the frame is selected, so a
 * busy frame reads from across the canvas.
 */
export function FrameDriverTag({ driver }: { driver: FrameDriverView }) {
  if (driver.kind === "agent") {
    return (
      <span
        data-frame-driver-tag=""
        className="flex h-[18px] shrink-0 items-center gap-1 rounded bg-foreground px-1.5 text-xs font-medium whitespace-nowrap text-background"
      >
        <GripSpinner className="size-3" />
        {AGENT_NAME} has control
      </span>
    )
  }
  if (driver.kind === "person") {
    return (
      <span
        data-frame-driver-tag=""
        className={`flex h-[18px] shrink-0 items-center rounded px-1.5 text-xs font-medium whitespace-nowrap ${presenceInkClass(driver.color)}`}
        style={{ backgroundColor: driver.color }}
      >
        {driver.name} has control
      </span>
    )
  }
  return null
}

/**
 * "Detached" on the frame's title line, where the driver tag goes, while
 * this viewer shows its own copy of a shared frame (#1397). Quiet, in the
 * title's type: nobody else sees it, and nothing here is anyone's alert.
 */
export function FrameLocalCopyTag() {
  return (
    <span
      data-frame-local-copy-tag=""
      className="flex h-[18px] shrink-0 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground"
    >
      <MonitorIcon className="size-3" />
      Detached
    </span>
  )
}

/**
 * The frame bar's Detach toggle (#1397), beside Interact on a shared frame.
 * It stays in the bar both ways, so going to your own copy and back never
 * resizes the bar: plain while you see the shared frame, the pressed ink
 * fill while you're on your own copy, where a click rejoins.
 */
export function FrameDetachToggle({
  detached,
  onToggle,
}: {
  detached: boolean
  onToggle: () => void
}) {
  return (
    <FloatingToolbarButton
      label={detached ? "Detached" : "Detach from shared frame"}
      hint={
        detached
          ? "Click to rejoin the shared frame"
          : "Use your own copy. Only you see it."
      }
      pressed={detached}
      onClick={onToggle}
    >
      <MonitorIcon />
    </FloatingToolbarButton>
  )
}

/** The colour of a driven frame's ring: the driver's, or none. */
export function frameDriverRingColor(
  driver: FrameDriverView
): string | "ink" | null {
  if (driver.kind === "agent") return "ink"
  if (driver.kind === "person") return driver.color
  return null
}
