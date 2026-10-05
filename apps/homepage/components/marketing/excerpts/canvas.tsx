import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BroadcastIcon,
  CaretDownIcon,
  CaretRightIcon,
  ChatsIcon,
  CircleIcon,
  CursorIcon,
  DotsThreeIcon,
  FileTextIcon,
  FrameCornersIcon,
  NavigationArrowIcon,
  ScribbleIcon,
  SidebarSimpleIcon,
  SlidersHorizontalIcon,
} from "@workspace/ui/components/icons"
import { cn } from "@workspace/ui/lib/utils"

import { Northwind } from "./northwind"

/*
 * The homepage's product excerpts (#1010 follow-up): pieces of the app redrawn
 * in HTML from the docs world, in place of cropped screenshots, so they stay
 * sharp at any width and follow the page's theme. They show; they don't work.
 */

/**
 * The edge of a floating bar or popover. The app draws a 10% hairline, which
 * vanishes once an excerpt is scaled down on the black page, so here it's
 * stronger and stays one CSS pixel at any scale (`--fit-scale`, from Fit).
 */
export const edge =
  "outline outline-[length:calc(1px/var(--fit-scale,1))] outline-foreground/25"

/** The shared floating toolbar surface (FloatingToolbar in @workspace/ui). */
export const floating = `flex items-center gap-1 rounded-lg bg-background p-1 shadow-md ${edge}`

/** A 28px icon button holding a 16px icon, as everywhere in the app. */
export function Tool({
  children,
  active,
  className,
}: {
  children: React.ReactNode
  /** Pressed, in the toggle's ink fill. */
  active?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md [&_svg]:size-4",
        active && "bg-foreground text-background",
        className
      )}
    >
      {children}
    </span>
  )
}

const DOTS = [5, 12, 19].flatMap((cy) => [5, 12, 19].map((cx) => [cx, cy]))

/**
 * A Workspace's state glyph: the ring when it's ready, the twinkling 3×3 grid
 * while its agent works (the app's GripSpinner).
 */
export function WorkspaceGlyph({
  state = "ready",
  className,
}: {
  state?: "ready" | "working"
  className?: string
}) {
  if (state === "ready") {
    return <CircleIcon className={cn("size-3 shrink-0", className)} />
  }
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("size-3 shrink-0 fill-current", className)}
    >
      {DOTS.map(([cx, cy], i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={2}
          className="grip-dot"
          style={{ animationDelay: `${-((i * 7) % 9) * 0.21}s` }}
        />
      ))}
    </svg>
  )
}

/** Lines added and removed, in the app's green and red. */
export function Diff({ add, del }: { add: number; del: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1 font-mono text-xs whitespace-nowrap tabular-nums">
      <span className="text-success">+{add}</span>
      <span className="text-destructive">-{del}</span>
    </span>
  )
}

/**
 * A frame on the canvas: its label above, the page inside. Selected, it gets
 * the canvas's magenta ring, handles and label. As in the app, a Group of two
 * or more names its Workspace once, on the title over its first frame; a
 * frame on its own names its Workspace after its name.
 */
export function Frame({
  label,
  group,
  workspace,
  working,
  selected,
  fadeHandles,
  device = "desktop",
  className,
  style,
  children,
}: {
  label: string
  /** The Group's title over its first frame: its name and Workspace. Only
   *  on a Group of two or more. */
  group?: [name: string, workspace: string]
  /** The Workspace a frame on its own shows, after its name. */
  workspace?: string
  /** Its Workspace's agent is at work: the twinkling grid for the ring. */
  working?: boolean
  selected?: boolean
  /** Someone else has control: no handles, the ring stays (#1588). */
  fadeHandles?: boolean
  device?: "desktop" | "mobile"
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  const handle = cn(
    "border-selection absolute size-[7px] border-[1.5px] bg-background",
    fadeHandles && "hidden"
  )
  return (
    <div className={cn("absolute", className)} style={style}>
      {group ? (
        <GroupLabel
          name={group[0]}
          workspace={group[1]}
          className="bottom-full left-0 mb-6 max-w-full"
        />
      ) : null}
      <div className="absolute bottom-full left-0 mb-1.5 flex max-w-full items-center gap-2 overflow-hidden text-xs leading-none whitespace-nowrap text-muted-foreground">
        {/* The figures' names are short: kept whole, as a rounding error would
            otherwise clip them to an ellipsis. */}
        <span
          className={cn(
            "shrink-0 font-medium text-foreground/70",
            selected && "text-selection"
          )}
        >
          {label}
        </span>
        {workspace ? (
          // The name keeps its room; the Workspace truncates first.
          <span className="flex min-w-10 shrink-[100] items-center gap-1">
            <WorkspaceGlyph
              state={working ? "working" : "ready"}
              className="size-2.5"
            />
            <span className="truncate">{workspace}</span>
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          "[container-type:inline-size] relative overflow-hidden bg-white",
          device === "desktop" ? "aspect-[16/10]" : "aspect-[390/760]"
        )}
      >
        {children}
      </div>
      {selected ? (
        <>
          <div className="outline-selection pointer-events-none absolute inset-0 outline-[1.5px] outline-solid" />
          <span className={cn(handle, "-top-[3.5px] -left-[3.5px]")} />
          <span className={cn(handle, "-top-[3.5px] -right-[3.5px]")} />
          <span className={cn(handle, "-bottom-[3.5px] -left-[3.5px]")} />
          <span className={cn(handle, "-right-[3.5px] -bottom-[3.5px]")} />
        </>
      ) : null}
    </div>
  )
}

/** A Group's title on the canvas, with the Workspace it shows. */
function GroupLabel({
  name,
  workspace,
  className,
  style,
}: {
  name: string
  workspace: string
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      className={cn(
        "absolute flex items-center gap-2 text-xs leading-none whitespace-nowrap text-muted-foreground",
        className
      )}
      style={style}
    >
      <span className="shrink-0">{name}</span>
      <span className="flex min-w-0 items-center gap-1">
        <WorkspaceGlyph className="size-2.5" />
        <span className="truncate">{workspace}</span>
      </span>
    </div>
  )
}

/**
 * The Safari-style bar under the selected frame, as wide as the frame: back
 * and forward, the address (the route, then record and reload), then
 * Interact, Go live where the frame can go live, Knobs and the menu. The
 * frame's label names its Workspace, so the address holds only the route.
 */
export function FrameBar({
  route = "/",
  live,
  driver,
  className,
  style,
}: {
  route?: string
  /** The frame is live for everyone: Go live shows, pressed. Unset, the bar
   *  has no Go live, as on the desktop app. */
  live?: boolean
  /** Who has control, in place of Interact: their face in their colour. */
  driver?: { initial: string; color: string }
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      className={cn(floating, "absolute text-sm whitespace-nowrap", className)}
      style={style}
    >
      <Tool>
        <ArrowLeftIcon />
      </Tool>
      <Tool>
        <ArrowRightIcon />
      </Tool>
      <span className="flex h-7 min-w-0 flex-1 items-center rounded-md bg-muted px-0.5 text-muted-foreground">
        <span className="ml-0.5 flex h-5 min-w-0 flex-1 items-center truncate px-1 font-mono text-xs">
          {route}
        </span>
        <Tool>
          <span className="size-2 rounded-full bg-current" />
        </Tool>
        <Tool>
          <ArrowClockwiseIcon />
        </Tool>
      </span>
      <span className="mx-0.5 h-4 w-px shrink-0 bg-foreground/10" />
      {driver ? (
        <Tool className="bg-secondary">
          <span
            className="flex size-4! items-center justify-center rounded-full text-xs font-medium text-neutral-950"
            style={{ backgroundColor: driver.color }}
          >
            {driver.initial}
          </span>
        </Tool>
      ) : (
        <Tool>
          <CursorIcon />
        </Tool>
      )}
      {live !== undefined ? (
        <Tool active={live}>
          <BroadcastIcon />
        </Tool>
      ) : null}
      <Tool>
        <SlidersHorizontalIcon />
      </Tool>
      <Tool>
        <DotsThreeIcon className="text-muted-foreground" />
      </Tool>
    </div>
  )
}

/**
 * One chat's row in the Chats menu: its Workspace's state glyph, title and
 * changed lines. Highlighted, its … sits over the row's end, a fade in the
 * row's colour running under the lines it covers.
 */
export function WorkspaceRow({
  name,
  working,
  highlighted,
  diff,
}: {
  name: string
  working?: boolean
  highlighted?: boolean
  diff?: readonly [number, number]
}) {
  return (
    <div
      className={cn(
        "relative flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
        highlighted && "bg-muted"
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {working ? (
          <WorkspaceGlyph state="working" className="size-3.5 opacity-70" />
        ) : (
          <CircleIcon weight="bold" className="size-3 opacity-50" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {diff ? <Diff add={diff[0]} del={diff[1]} /> : null}
      {highlighted ? (
        <span className="absolute inset-y-0 right-0.5 flex items-center bg-muted">
          <span className="pointer-events-none absolute inset-y-0 -left-4 w-4 bg-gradient-to-r from-transparent to-muted" />
          <Tool>
            <DotsThreeIcon className="text-muted-foreground" />
          </Tool>
        </span>
      ) : null}
    </div>
  )
}

/** The three versions the figures ask for, in canvas order. */
export const versions = [
  {
    version: "gradient",
    title: "Gradient headline",
    brief: "Accent-to-cyan headline and a trust line",
    prompt:
      "Run the headline from the accent color to cyan and add a trust line.",
    diff: [14, 3],
  },
  {
    version: "split",
    title: "Split layout",
    brief: "Copy on the left, the chart beside it",
    prompt: "Put the copy on the left and the chart beside it.",
    diff: [38, 21],
  },
  {
    version: "dark",
    title: "Dark hero",
    brief: "The hero on a dark background",
    prompt: "Put the hero on a dark background with a soft accent glow.",
    diff: [27, 6],
  },
] as const

/** The ask the figures tell the story of. */
export const ask = "Try three versions of the homepage hero."

/** The user's message in a chat: a soft bubble on the right, filled as the
 *  app fills it (agent-message.tsx). */
export function UserBubble({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <p
      className={cn(
        "ml-8 self-end rounded-xl bg-muted px-3 py-1.5 dark:bg-input/70",
        className
      )}
    >
      {children}
    </p>
  )
}

/**
 * A chat the Coordinator started, as a card in its transcript: the
 * Workspace's state glyph, title, changed lines, the state in a word and a
 * caret, then the message it was started on.
 */
export function ChatCard({
  title,
  prompt,
  diff,
  working,
}: {
  title: string
  prompt: string
  diff: readonly [number, number]
  working?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-input/70 px-2.5 py-2">
      <span className="flex items-center gap-2">
        <span className="flex size-4 shrink-0 items-center justify-center">
          {working ? (
            <WorkspaceGlyph state="working" className="size-3.5 opacity-70" />
          ) : (
            <CircleIcon weight="bold" className="size-3 opacity-50" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
        <Diff add={diff[0]} del={diff[1]} />
        <span className="shrink-0 text-xs text-muted-foreground">
          {working ? "Working" : "Ready"}
        </span>
        <CaretRightIcon className="size-3 shrink-0 text-muted-foreground" />
      </span>
      <span className="truncate pl-6 text-xs text-muted-foreground">
        {prompt}
      </span>
    </div>
  )
}

/**
 * The chat panel at its home, the Coordinator: the ask and the three
 * Workspaces it started straight away, each a chat card updating in place.
 */
function Coordinator() {
  return (
    <div className="flex w-[320px] shrink-0 flex-col border-l border-border bg-background max-lg:hidden">
      <div className="flex h-12 items-center border-b border-border px-3 text-sm whitespace-nowrap">
        <Tool>
          <SidebarSimpleIcon mirrored className="text-muted-foreground" />
        </Tool>
        <span className="ml-1.5 min-w-0 flex-1 truncate font-medium">
          Coordinator
        </span>
        {/* The outline Chats button that opens the Chats menu. */}
        <span className="flex h-6 items-center gap-1 rounded-md border border-input bg-input/30 pr-2 pl-1.5 text-xs">
          <ChatsIcon className="size-3" />
          Chats
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-hidden px-3 py-4 text-[13px] leading-normal">
        <UserBubble>{ask}</UserBubble>
        <p>Starting a chat for each version.</p>
        <div className="flex flex-col gap-1">
          {versions.map((v) => (
            <ChatCard
              key={v.title}
              title={v.title}
              prompt={v.prompt}
              diff={v.diff}
              working={v.version === "dark"}
            />
          ))}
        </div>
        <p>
          Gradient headline and Split layout are ready. Dark hero is still
          working.
        </p>
      </div>
      <div className="m-3 mt-0 flex flex-col gap-3 rounded-lg border border-border p-3 text-[13px]">
        <span className="truncate text-muted-foreground">
          Ask the Coordinator… (@ document, / skill)
        </span>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            Opus 5.5
            <CaretDownIcon className="size-3 text-muted-foreground" />
          </span>
          <span className="ml-auto flex size-7 items-center justify-center rounded-md bg-muted-foreground text-background">
            <ArrowUpIcon className="size-4" />
          </span>
        </div>
      </div>
    </div>
  )
}

/** The canvas's floating chrome: breadcrumb, zoom and the tools: Select,
 *  Frame, Mockup and Document. */
export function CanvasChrome({ zoom }: { zoom: string }) {
  return (
    <>
      <div
        className={cn(
          floating,
          // Clear of the zoom pill: on a narrow canvas the name truncates.
          "absolute top-2 left-2 z-10 max-w-[calc(100%-6rem)] text-sm whitespace-nowrap"
        )}
      >
        {/* The sidebar is collapsed, so its toggle leads the breadcrumb. */}
        <Tool>
          <SidebarSimpleIcon />
        </Tool>
        <span className="flex h-7 min-w-0 items-center gap-1.5 pl-1">
          <span className="text-muted-foreground">All files</span>
          <span className="text-muted-foreground">/</span>
          <span className="truncate">Northwind marketing site</span>
        </span>
        <Tool>
          <DotsThreeIcon className="text-muted-foreground" />
        </Tool>
      </div>
      <div className={cn(floating, "absolute top-2 right-2 z-10 px-2 text-sm")}>
        <span className="flex h-7 items-center gap-1 tabular-nums">
          {zoom}
          <CaretDownIcon className="size-3 text-muted-foreground" />
        </span>
      </div>
      <div
        className={cn(
          floating,
          "absolute bottom-3 left-1/2 z-10 -translate-x-1/2"
        )}
      >
        <Tool active>
          <NavigationArrowIcon />
        </Tool>
        <Tool>
          <FrameCornersIcon />
        </Tool>
        <Tool>
          <ScribbleIcon />
        </Tool>
        <Tool>
          <FileTextIcon />
        </Tool>
      </div>
    </>
  )
}

/**
 * Fig. 1's columns: where each version starts and how wide it is. Phones
 * have room for two versions, so the third drops out.
 */
export const columns =
  "[--w:44%] [--h:27.5cqw] [--gap:36px] [--l0:4%] [--l1:52%] sm:[--w:29%] sm:[--h:18.125cqw] sm:[--gap:76px] sm:[--l1:35.5%] [--l2:67%]"

/**
 * The hero's figure: one ask to the Coordinator and its three Workspaces,
 * side by side on the canvas, desktop over phone, with the selected one's
 * bar. The chat drops out on narrow screens, leaving the canvas, and phones
 * drop the phone frames, too narrow there to name their Workspace.
 */
export function CanvasExcerpt() {
  return (
    <div
      role="img"
      aria-label="The Screenplay canvas: three versions of the Northwind homepage hero running side by side, each in its own Workspace, with the Coordinator chat that started them on the right."
      className="flex aspect-[4/3] w-full overflow-hidden border border-border bg-background text-foreground sm:aspect-[16/10] lg:aspect-[16/9.4]"
    >
      <div
        className={cn(
          "bg-plane [container-type:inline-size] relative min-w-0 flex-1 overflow-hidden",
          columns
        )}
        style={
          {
            // Frames start below the breadcrumb, however short the canvas.
            "--top": "max(17%, 88px)",
            // Each column's phone frame starts under the desktop frame's bar, or
            // right under the frame on phones, where the bar is hidden.
            "--phone": "calc(var(--top) + var(--h) + var(--gap))",
          } as React.CSSProperties
        }
      >
        <CanvasChrome zoom="31%" />
        {versions.map((v, i) => (
          <Frame
            key={v.title}
            label="Home"
            workspace={v.title}
            selected={i === 1}
            className={cn(i === 2 && "max-sm:hidden")}
            style={{
              left: `var(--l${i})`,
              top: "var(--top)",
              width: "var(--w)",
            }}
          >
            <Northwind version={v.version} />
          </Frame>
        ))}
        <FrameBar
          className="z-[5] max-sm:hidden"
          // Centred under the middle frame like the app's: as wide as the
          // frame, or 360px under a narrow one, never past the canvas's edges.
          style={{
            left: "max(8px, calc(50% - min(max(14.5%, 180px), 50% - 8px)))",
            width: "min(max(29%, 360px), calc(100% - 16px))",
            top: "calc(var(--top) + var(--h) + 10px)",
          }}
        />
        {versions.map((v, i) => (
          <Frame
            key={v.title}
            label="Mobile"
            workspace={v.title}
            device="mobile"
            className="max-sm:hidden"
            // Wide enough for its name and most of its Workspace's.
            style={{ left: `var(--l${i})`, top: "var(--phone)", width: "16%" }}
          >
            <Northwind device="mobile" version={v.version} />
          </Frame>
        ))}
      </div>
      <Coordinator />
    </div>
  )
}
