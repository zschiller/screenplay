import {
  ArrowClockwiseIcon,
  ArrowUpIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpDownIcon,
  CircleIcon,
  CursorIcon,
  DotsThreeIcon,
  FileTextIcon,
  FolderOpenIcon,
  FrameCornersIcon,
  GitPullRequestIcon,
  PlusIcon,
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

/** The small uppercase heading of a sidebar section. */
const sectionLabel =
  "font-mono text-[11px] leading-none font-medium tracking-[0.08em] text-muted-foreground uppercase"

/** The shared floating toolbar surface (FloatingToolbar in @workspace/ui). */
export const floating =
  "flex items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/10"

/** A 24px toolbar button holding a 12px icon. */
function Tool({
  children,
  active,
}: {
  children: React.ReactNode
  active?: boolean
}) {
  return (
    <span
      className={cn(
        "flex size-6 items-center justify-center rounded-md [&_svg]:size-3",
        active && "bg-foreground text-background"
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
    <span className="font-mono text-[11px] tabular-nums">
      <span className="text-success">+{add}</span>{" "}
      <span className="text-destructive">-{del}</span>
    </span>
  )
}

/**
 * A frame on the canvas: its label above, the page inside. Selected, it gets
 * the canvas's magenta ring, handles and label. The first frame of a Group
 * carries the Group's title above its own.
 */
export function Frame({
  label,
  group,
  selected,
  device = "desktop",
  className,
  style,
  children,
}: {
  label: string
  /** The Group's title over its first frame: its name and Workspace. */
  group?: [name: string, workspace: string]
  selected?: boolean
  device?: "desktop" | "mobile"
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  const handle =
    "absolute size-[7px] border-[1.5px] border-selection bg-background"
  return (
    <div className={cn("absolute", className)} style={style}>
      {group ? (
        <GroupLabel
          name={group[0]}
          workspace={group[1]}
          className="bottom-full left-0 mb-6"
        />
      ) : null}
      <div
        className={cn(
          "absolute bottom-full left-0 mb-1.5 truncate text-[11px] leading-none whitespace-nowrap",
          selected ? "text-selection" : "text-muted-foreground"
        )}
      >
        {label}
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
        "absolute flex items-center gap-2 text-[11px] leading-none whitespace-nowrap text-muted-foreground",
        className
      )}
      style={style}
    >
      <span>{name}</span>
      <span className="flex items-center gap-1">
        <WorkspaceGlyph className="size-2.5" />
        {workspace}
      </span>
    </div>
  )
}

/**
 * The Safari-style bar under the selected frame (#795): pick, back and
 * forward, the Workspace and route, reload, record, knobs and the menu.
 */
export function FrameBar({
  workspace,
  className,
  style,
}: {
  workspace: string
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      className={cn(floating, "absolute text-xs whitespace-nowrap", className)}
      style={style}
    >
      <Tool>
        <CursorIcon />
      </Tool>
      <span className="mx-0.5 h-4 w-px bg-foreground/10" />
      <Tool>
        <CaretLeftIcon />
      </Tool>
      <Tool>
        <CaretRightIcon />
      </Tool>
      <span className="flex h-6 items-center gap-1.5 rounded-md bg-muted px-2">
        <WorkspaceGlyph />
        <span>{workspace}</span>
        <CaretUpDownIcon className="size-3 text-muted-foreground" />
        <span className="text-muted-foreground">/</span>
      </span>
      <Tool>
        <ArrowClockwiseIcon />
      </Tool>
      <Tool>
        <span className="size-2 rounded-full bg-[oklch(0.637_0.237_25.331)]" />
      </Tool>
      <span className="mx-0.5 h-4 w-px bg-foreground/10" />
      <Tool>
        <SlidersHorizontalIcon />
      </Tool>
      <Tool>
        <DotsThreeIcon />
      </Tool>
    </div>
  )
}

/** One row of the sidebar's Workspaces list. */
export function WorkspaceRow({
  name,
  state,
  selected,
  diff,
  pr,
  menu,
}: {
  name: string
  state?: "ready" | "working"
  selected?: boolean
  diff?: [number, number]
  pr?: number
  menu?: boolean
}) {
  return (
    <div
      className={cn(
        "flex h-8 items-center gap-2 rounded-md px-2 text-sm",
        selected && "bg-sidebar-accent"
      )}
    >
      <WorkspaceGlyph state={state} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {diff ? <Diff add={diff[0]} del={diff[1]} /> : null}
      {pr ? (
        <span className="flex items-center gap-1 text-xs text-success">
          <GitPullRequestIcon className="size-3" />#{pr}
        </span>
      ) : null}
      {menu ? (
        <DotsThreeIcon className="size-3.5 text-muted-foreground" />
      ) : null}
    </div>
  )
}

function TreeRow({
  icon,
  name,
  indent,
  selected,
  aside,
}: {
  icon: React.ReactNode
  name: string
  indent?: boolean
  selected?: boolean
  aside?: string
}) {
  return (
    <div
      className={cn(
        "flex h-8 items-center gap-2 rounded-md px-2 text-sm [&>svg]:size-3.5 [&>svg]:shrink-0",
        indent && "ml-4",
        selected && "bg-sidebar-accent"
      )}
    >
      {icon}
      <span className="shrink-0">{name}</span>
      {aside ? (
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <WorkspaceGlyph className="size-2.5" />
          <span className="truncate">{aside}</span>
        </span>
      ) : null}
    </div>
  )
}

/** The canvas sidebar: the Workspaces list and the canvas's layers. */
function Sidebar() {
  return (
    <div className="flex w-[216px] shrink-0 flex-col gap-1 border-r border-border bg-sidebar px-2 py-3 max-md:hidden">
      <div className="flex justify-end px-1.5 pb-1 text-muted-foreground">
        <SidebarSimpleIcon className="size-3.5" />
      </div>
      <div className="flex items-center justify-between px-2 pt-1 pb-2">
        <span className={sectionLabel}>Workspaces</span>
        <span className="flex gap-2 text-muted-foreground">
          <DotsThreeIcon className="size-3.5" />
          <PlusIcon className="size-3.5" />
        </span>
      </div>
      <WorkspaceRow name="Customer stories" state="working" />
      <WorkspaceRow name="Hero gradient & trust line" selected />
      <WorkspaceRow name="Pricing FAQ" diff={[11, 0]} />
      <div className="px-2 pt-5 pb-2">
        <span className={sectionLabel}>Canvas</span>
      </div>
      <TreeRow
        icon={<FolderOpenIcon />}
        name="Homepage"
        aside="Hero gradient"
      />
      <TreeRow icon={<FrameCornersIcon />} name="Home" indent selected />
      <TreeRow icon={<FrameCornersIcon />} name="Home · mobile" indent />
      <TreeRow icon={<FolderOpenIcon />} name="Pricing" aside="Pricing FAQ" />
      <TreeRow icon={<FrameCornersIcon />} name="Pricing" indent />
      <TreeRow icon={<FileTextIcon />} name="Pricing launch checklist" />
    </div>
  )
}

/** The agent's chat for the selected Workspace. */
function Chat() {
  return (
    <div className="flex w-[296px] shrink-0 flex-col border-l border-border bg-background max-lg:hidden">
      <div className="flex h-11 items-center gap-2 border-b border-border px-3 text-sm">
        <WorkspaceGlyph />
        <span className="min-w-0 flex-1 truncate font-medium">
          Hero gradient &amp; trust line
        </span>
        <Diff add={3} del={0} />
        <span className="flex h-6 items-center gap-1 rounded-md border border-border px-2 text-xs">
          <GitPullRequestIcon className="size-3" />
          Create PR
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-hidden px-3 py-4 text-[13px] leading-normal">
        <p className="ml-6 rounded-lg bg-muted px-3 py-2">
          Make the hero headline a gradient from the accent color to cyan, and
          add a small &ldquo;Trusted by 4,000+ product teams&rdquo; line under
          the buttons.
        </p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <CaretRightIcon className="size-3" />
          Read 2 files, edited 2, ran 3 commands
        </p>
        <p>Done. The preview has already reloaded:</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-4">
          <li>
            <span className="font-medium">Headline</span> now runs from the
            accent color to cyan. It follows the Accent color knob.
          </li>
          <li>
            <span className="font-medium">Trust line</span> sits under the
            buttons in muted 13px.
          </li>
        </ul>
      </div>
      <div className="m-3 mt-0 flex flex-col gap-3 rounded-lg border border-border p-3 text-[13px]">
        <span className="text-muted-foreground">Ask the agent…</span>
        <div className="flex items-center gap-1 text-xs">
          <span>Claude Code · Opus</span>
          <CaretDownIcon className="size-3 text-muted-foreground" />
          <span className="ml-auto flex size-6 items-center justify-center rounded-md bg-foreground text-background">
            <ArrowUpIcon className="size-3" />
          </span>
        </div>
      </div>
    </div>
  )
}

/** The canvas's floating chrome: breadcrumb, zoom and the tool bar. */
function CanvasChrome({ zoom }: { zoom: string }) {
  return (
    <>
      <div
        className={cn(floating, "absolute top-3 left-3 z-10 px-2.5 text-xs")}
      >
        <span className="flex h-6 items-center gap-1.5">
          <span className="text-muted-foreground">All files</span>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">Northwind marketing site</span>
        </span>
      </div>
      <div className={cn(floating, "absolute top-3 right-3 z-10 px-2 text-xs")}>
        <span className="flex h-6 items-center gap-1 tabular-nums">
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
          <CursorIcon />
        </Tool>
        <Tool>
          <FrameCornersIcon />
        </Tool>
        <Tool>
          <FileTextIcon />
        </Tool>
      </div>
    </>
  )
}

/**
 * The hero's figure: the whole canvas with its sidebar and the agent's chat,
 * three Workspaces' frames and the selected one's bar. The sidebar and chat
 * drop out on narrow screens, leaving the canvas.
 */
export function CanvasExcerpt() {
  return (
    <div
      role="img"
      aria-label="The Screenplay canvas: Workspaces and layers in the sidebar, the Northwind site's frames running side by side with one selected, and the agent's chat on the right."
      className="flex aspect-square w-full overflow-hidden border border-border bg-background text-foreground sm:aspect-[16/10] lg:aspect-[16/9.4]"
    >
      <Sidebar />
      <div
        className="bg-plane [container-type:inline-size] relative min-w-0 flex-1 overflow-hidden"
        // Frames start below the breadcrumb, however short the canvas.
        style={{ "--top": "max(22%, 88px)" } as React.CSSProperties}
      >
        <CanvasChrome zoom="38%" />
        <Frame
          label="Home"
          group={["Homepage", "Hero gradient & trust line"]}
          selected
          style={{ left: "6%", top: "var(--top)", width: "66%" }}
        >
          <Northwind version="gradient" />
        </Frame>
        <FrameBar
          workspace="Hero gradient & trust line"
          className="z-[5] max-sm:hidden"
          style={{
            left: "39%",
            top: "calc(var(--top) + 41.25cqw + 10px)",
            translate: "-50% 0",
          }}
        />
        <Frame
          label="Home · mobile"
          device="mobile"
          style={{ left: "76%", top: "var(--top)", width: "17%" }}
        >
          <Northwind device="mobile" version="gradient" />
        </Frame>
        <Frame
          label="Pricing"
          group={["Pricing", "Pricing FAQ"]}
          style={{
            left: "6%",
            top: "calc(var(--top) + 41.25cqw + 96px)",
            width: "66%",
          }}
        >
          <Northwind page="pricing" />
        </Frame>
      </div>
      <Chat />
    </div>
  )
}

/**
 * A closer look at one selected frame and its bar, with the next Workspace's
 * frames beside it: the problem section's "with Screenplay" side.
 */
export function FrameExcerpt() {
  return (
    <div
      role="img"
      aria-label="A selected frame on the canvas, with its bar underneath, next to another Workspace's frames of the same page."
      className="bg-plane [container-type:inline-size] relative aspect-[16/10] w-full overflow-hidden border border-border"
      style={{ "--top": "max(14%, 44px)" } as React.CSSProperties}
    >
      <Frame
        label="Home"
        group={["Homepage", "Hero gradient & trust line"]}
        selected
        style={{ left: "5%", top: "var(--top)", width: "62%" }}
      >
        <Northwind version="gradient" />
      </Frame>
      <FrameBar
        workspace="Hero gradient & trust line"
        className="z-[5] max-sm:hidden"
        style={{
          left: "36%",
          top: "calc(var(--top) + 38.75cqw + 10px)",
          translate: "-50% 0",
        }}
      />
      <Frame
        label="Home"
        group={["Homepage", "Main"]}
        style={{ left: "72%", top: "var(--top)", width: "62%" }}
      >
        <Northwind />
      </Frame>
    </div>
  )
}
