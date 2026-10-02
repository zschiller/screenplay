"use client"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { FloatingToolbarButton } from "@workspace/ui/components/floating-toolbar"
import { CursorIcon } from "@workspace/ui/components/icons"
import { GripSpinner } from "@/components/grip-spinner"
import { presenceInkClass } from "@/lib/canvas/presence-ink"
import type { FrameDriverView } from "./use-frame-control"

/** The agent's name where Frame Control names who drives. */
const AGENT_NAME = "Claude"

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
  return (
    <Avatar className="size-4 after:hidden">
      {driver.avatar ? <AvatarImage src={driver.avatar} alt="" /> : null}
      <AvatarFallback
        aria-hidden
        style={{ backgroundColor: driver.color }}
        className={`text-xs font-medium ${presenceInkClass(driver.color)}`}
      >
        {initial(driver.name)}
      </AvatarFallback>
    </Avatar>
  )
}

/**
 * The frame bar's Interact button, which is also the driver button (#1376).
 * Nobody drives, or you do: today's Interact toggle, pressed in the selection
 * fill while you interact. Someone else drives: their mark on the quiet
 * pressed fill, with a two-line tooltip naming who drives and what a click
 * does (takes over from the agent at once, or asks the person).
 */
export function FrameDriverButton({
  driver,
  onClick,
}: {
  driver: FrameDriverView
  onClick: () => void
}) {
  if (driver.kind === "agent" || driver.kind === "person") {
    const name = driver.kind === "agent" ? AGENT_NAME : driver.name
    return (
      <FloatingToolbarButton
        label={`${name} is driving`}
        hint={
          driver.kind === "agent"
            ? "Click to take over"
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
  return (
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
}

/**
 * "Claude is driving" on the frame's title line, right-aligned to the frame,
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
        {AGENT_NAME} is driving
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
        {driver.name} is driving
      </span>
    )
  }
  return null
}

/** The colour of a driven frame's ring: the driver's, or none. */
export function frameDriverRingColor(
  driver: FrameDriverView
): string | "ink" | null {
  if (driver.kind === "agent") return "ink"
  if (driver.kind === "person") return driver.color
  return null
}
