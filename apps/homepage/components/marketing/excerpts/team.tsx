import {
  ChatIcon,
  DotsThreeIcon,
  CaretDownIcon,
} from "@workspace/ui/components/icons"
import { cn } from "@workspace/ui/lib/utils"

import { floating, Frame, FrameBar, Tool } from "./canvas"
import { Fit } from "./fit"
import { Northwind } from "./northwind"

/*
 * The For teams figure: the canvas as a team sees it on the web app. The
 * top-right pill carries the comments count, the facepile and Share; a
 * teammate's cursor and a pinned comment are on the selected frame. Drawn from the app's comment and presence components.
 */

/** Presence colours from the app's palette, with the dark ink it picks. */
const people = [
  { initials: "M", color: "#81C784" },
  { initials: "S", color: "#64B5F6" },
  { initials: "J", color: "#FFB74D" },
] as const

/** A facepile avatar: 24px, an initial on the person's presence colour. */
function Face({ initials, color }: { initials: string; color: string }) {
  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium text-neutral-950 ring-2 ring-background"
      style={{ backgroundColor: color }}
    >
      {initials}
    </span>
  )
}

/** The canvas's top-right pill on the web app: zoom, comments, people, Share. */
function PeoplePill() {
  return (
    <div className={cn(floating, "absolute top-2 right-2 z-10 text-xs")}>
      <span className="flex h-6 items-center gap-1 px-1.5 text-sm tabular-nums">
        38%
        <CaretDownIcon className="size-3 text-muted-foreground" />
      </span>
      <span className="flex h-6 items-center gap-1 px-1.5 tabular-nums [&_svg]:size-3">
        <ChatIcon />2
      </span>
      <span className="ml-0.5 flex flex-row-reverse items-center [&>*:not(:last-child)]:-ml-1">
        {people.map((p) => (
          <Face key={p.initials} {...p} />
        ))}
      </span>
      <span className="ml-1 flex h-6 items-center rounded-md bg-foreground px-2 font-medium text-background">
        Share
      </span>
    </div>
  )
}

/** A teammate's cursor with their name, as the canvas draws other people. */
function Cursor({
  name,
  color,
  className,
  style,
}: {
  name: string
  color: string
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div className={cn("absolute z-[6]", className)} style={style}>
      <svg
        width="16"
        height="20"
        viewBox="0 0 16 20"
        fill="none"
        aria-hidden
        style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }}
      >
        <path
          d="M0.928711 0.0737305L15.0713 11.3833L8.20055 11.8235L4.56463 19.0005L0.928711 0.0737305Z"
          fill={color}
        />
      </svg>
      <span
        className="mt-1 ml-3 inline-block rounded px-1.5 py-0.5 text-xs whitespace-nowrap text-neutral-950"
        style={{ backgroundColor: color }}
      >
        {name}
      </span>
    </div>
  )
}

/**
 * "Sam has control" on the selected frame's title line, right-aligned to the
 * frame, on Sam's cursor colour, as the app's FrameDriverTag draws a person.
 */
function DriverTag({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="absolute z-[6] flex h-[18px] -translate-x-full items-center rounded px-1.5 text-xs font-medium whitespace-nowrap text-neutral-950"
      style={{ backgroundColor: color, left: 432, top: 62 }}
    >
      {name} has control
    </span>
  )
}

/** The comment pin: yellow, numbered, its bottom-left tip on the element. */
function Pin({ number }: { number: number }) {
  return (
    <span className="bg-comment flex size-6.5 items-center justify-center rounded-[13px_13px_13px_3px] text-xs font-semibold text-black tabular-nums shadow-md">
      {number}
    </span>
  )
}

function Comment({
  name,
  ago,
  children,
}: {
  name: string
  ago: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
        {name[0]}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex h-5 items-center gap-1.5">
          <span className="truncate font-medium">{name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{ago}</span>
        </div>
        <p className="text-pretty">{children}</p>
      </div>
    </div>
  )
}

/** The open thread's card, a popover beside its pin. */
function ThreadCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "absolute flex w-[250px] flex-col gap-2.5 rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="inline-flex h-5 min-w-0 items-center rounded-md bg-muted px-1.5 text-xs text-muted-foreground">
          <span className="truncate">/ · a.btn</span>
        </span>
        <span className="ml-auto flex shrink-0 items-center text-muted-foreground">
          <span className="flex h-6 items-center px-2 text-xs">Resolve</span>
          <Tool>
            <DotsThreeIcon />
          </Tool>
        </span>
      </div>
      <div className="flex flex-col gap-3">
        <Comment name="Maya" ago="4m">
          Should this just say Start free? It reads long next to Book a demo.
        </Comment>
        <Comment name="Sam" ago="1m">
          Agreed. Sending it to the agent.
        </Comment>
      </div>
    </div>
  )
}

/**
 * The selected frame, live, with its bar, Sam in control of it, their
 * cursor on its headline and a
 * pinned comment open on its button, the next Workspace's frame beside it,
 * and the people pill above. Laid out at a fixed size and scaled to the
 * column like an image, so the thread card always fits beside its pin.
 */
export function TeamExcerpt() {
  return (
    <Fit
      width={640}
      height={440}
      initialScale={0.9}
      role="img"
      aria-label="A shared canvas on the web app: three teammates' avatars in the top corner, a teammate's cursor on the selected frame they have control of, and a pinned comment thread open on its sign-up button."
      className="border border-border"
    >
      <div className="bg-plane relative size-full overflow-hidden text-foreground">
        <PeoplePill />
        <Frame
          label="Home"
          workspace="Hero gradient & trust line"
          selected
          style={{ left: 32, top: 84, width: 400 }}
        >
          <Northwind version="gradient" />
        </Frame>
        <DriverTag name="Sam" color={people[1].color} />
        <FrameBar
          live
          driver={{ initial: "S", color: people[1].color }}
          className="z-[5]"
          style={{ left: 32, top: 344, width: 400 }}
        />
        <Frame
          label="Home"
          workspace="Main"
          style={{ left: 464, top: 84, width: 400 }}
        >
          <Northwind />
        </Frame>
        <Cursor
          name="Sam"
          color={people[1].color}
          style={{ left: 150, top: 262 }}
        />
        {/* The pin's tip on the button's corner, its thread card beside it. */}
        <div className="absolute z-[7]" style={{ left: 224, top: 230 }}>
          <div className="absolute bottom-0 left-0">
            <Pin number={1} />
          </div>
          {/* Beside the pin, centred on it, so the bar under the frame
              stays in view. */}
          <ThreadCard className="top-[-110px] left-[34px]" />
        </div>
      </div>
    </Fit>
  )
}
