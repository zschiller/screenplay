import {
  ArrowUpIcon,
  CaretDownIcon,
  CaretUpDownIcon,
  DotsThreeIcon,
  FileTextIcon,
  FrameCornersIcon,
  GitPullRequestIcon,
  NavigationArrowIcon,
  ScribbleIcon,
  SidebarSimpleIcon,
} from "@workspace/ui/components/icons"
import { cn } from "@workspace/ui/lib/utils"

import {
  Diff,
  Frame,
  Tool,
  UserBubble,
  WorkspaceGlyph,
  floating,
  versions,
} from "./canvas"
import { Fit } from "./fit"
import { Northwind } from "./northwind"
import { Card } from "./steps"
import {
} from "./team"

const split = versions[1]
const dark = versions[2]

/** The send button: ink square, arrow up. */
export function Send({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background",
        className
      )}
    >
      <ArrowUpIcon className="size-4" />
    </span>
  )
}

/** The canvas toolbar, Select active. */
function Toolbar({ className }: { className?: string }) {
  return (
    <div className={cn(floating, "absolute", className)}>
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
  )
}

/**
 * A frame just drawn, phone-sized, beside the Split layout, with the ask card
 * the Frame tool opens: what it should show, and New chat beside Send.
 */
export function DrawFrameExcerpt() {
  const handle =
    "absolute size-[7px] border-[1.5px] border-selection bg-background"
  const x = 146
  const W = 320
  return (
    <Fit
      width={W}
      height={256}
      role="img"
      aria-label="A phone-sized frame just drawn on the canvas beside the Split layout, asking what it should show, with the answer typed and New chat beside Send."
      className="bg-plane border border-border text-foreground"
    >
      <div className="[container-type:inline-size] relative size-full">
        <Frame
          label="Home"
          workspace={split.title}
          style={{ left: 16, top: 46, width: 118 }}
        >
          <Northwind version={split.version} />
        </Frame>
        {/* The drawn frame: empty, selected, asking. */}
        <div className="absolute" style={{ left: x, top: 46, width: 70 }}>
          <div className="absolute bottom-full left-0 mb-1.5 flex items-center gap-1.5 text-xs leading-none whitespace-nowrap">
            <span className="font-medium text-selection">Frame</span>
            <span className="flex items-center gap-0.5 text-muted-foreground">
              Choose a workspace
              <CaretUpDownIcon className="size-3" />
            </span>
          </div>
          <div className="h-[136px] bg-muted/60" />
          <div className="outline-selection pointer-events-none absolute inset-0 outline-[1.5px] outline-solid" />
          <span className={cn(handle, "-top-[3.5px] -left-[3.5px]")} />
          <span className={cn(handle, "-top-[3.5px] -right-[3.5px]")} />
          <span className={cn(handle, "-bottom-[3.5px] -left-[3.5px]")} />
          <span className={cn(handle, "-right-[3.5px] -bottom-[3.5px]")} />
        </div>
        <div
          className={cn(
            "absolute flex w-[200px] flex-col gap-2.5 rounded-lg border border-border bg-background p-2.5 text-xs shadow-md"
          )}
          style={{ left: Math.min(x + 35 - 100, W - 212), top: 104 }}
        >
          <span>Make the hero work on phones</span>
          <span className="flex items-center justify-between">
            <span className="flex items-center gap-1 font-medium">
              New chat
              <CaretDownIcon className="size-3 text-muted-foreground" />
            </span>
            <Send className="size-6" />
          </span>
        </div>
        <Toolbar className="bottom-2.5 left-1/2 z-10 -translate-x-1/2 scale-90" />
      </div>
    </Fit>
  )
}

/** A chat panel's header inside a workspace chat. */
export function ChatHeader({
  title,
  diff,
  pr = true,
  crumb = true,
}: {
  title: string
  diff?: readonly [number, number]
  pr?: boolean
  crumb?: boolean
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2 text-sm whitespace-nowrap">
      {crumb ? (
        <>
          <Tool>
            <SidebarSimpleIcon mirrored className="text-muted-foreground" />
          </Tool>
          <span className="text-muted-foreground">Coordinator</span>
          <span className="mx-1 text-muted-foreground">/</span>
        </>
      ) : null}
      <span className="min-w-0 truncate pl-1 font-medium">{title}</span>
      <Tool className="size-6">
        <DotsThreeIcon className="text-muted-foreground" />
      </Tool>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
        {diff ? <Diff add={diff[0]} del={diff[1]} /> : null}
        {pr ? (
          <span className="flex h-6 items-center gap-1 rounded-md border border-input bg-input/30 px-2 text-xs font-medium [&_svg]:size-3.5">
            <GitPullRequestIcon />
            Create pull request
          </span>
        ) : null}
      </span>
    </div>
  )
}

/** Ship it: the picked version's chat, Create pull request in its header. */
export function PrHeaderExcerpt() {
  return (
    <Fit
      width={320}
      height={256}
      role="img"
      aria-label="The Split layout chat, with Create pull request in its header."
      className="border border-border bg-background text-foreground"
    >
      <div className="flex size-full flex-col">
        <ChatHeader title={split.title} crumb={false} />
        <div className="flex flex-col gap-3 px-3 py-3 text-xs leading-normal">
          <p>
            The copy sits on the left now, with the chart beside it. On phones
            the chart drops under the buttons.
          </p>
          <UserBubble>Make the chart a little taller, then it’s good.</UserBubble>
          <p>Done. The chart is 40px taller on desktop.</p>
        </div>
      </div>
    </Fit>
  )
}

/** A tool row in a chat: small icon, the verb, the detail muted. */
export function ToolRow({
  icon,
  verb,
  detail,
}: {
  icon: React.ReactNode
  verb: string
  detail?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-0.5 text-xs [&_svg]:size-3 [&_svg]:shrink-0">
      {icon}
      <span className="shrink-0">{verb}</span>
      {detail ? (
        <span className="truncate text-muted-foreground">{detail}</span>
      ) : null}
    </div>
  )
}

/* ---------- Plan it, Sketch it: a prompt and what it made ---------- */

/** A prompt, as it sits in a chat: the user's bubble, then the files the
 * agent read from your code before it answered. */
function Prompt({
  reads,
  children,
}: {
  reads: string[]
  children: React.ReactNode
}) {
  return (
    <div className="absolute inset-x-3 bottom-3 flex flex-col gap-1.5">
      <span className="self-end rounded-lg bg-muted px-2.5 py-1.5 text-xs">
        {children}
      </span>
      {reads.map((file) => (
        <ToolRow key={file} icon={<FileTextIcon />} verb="Read" detail={file} />
      ))}
    </div>
  )
}

/** Sketch it: the live page beside a mockup a chat drew of a darker take. */
export function SketchExcerpt() {
  return (
    <Card label="The live Split layout page beside a mockup an agent sketched of a dark take from the app’s own code, with the prompt that asked for it.">
      <Frame
        label="Home"
        workspace={split.title}
        style={{ left: 16, top: 46, width: 138 }}
      >
        <Northwind version={split.version} />
      </Frame>
      <Frame
        label="Take A · Dark hero"
        selected
        style={{ left: 166, top: 46, width: 138 }}
      >
        <Northwind version={dark.version} />
      </Frame>
      <Prompt reads={["app/page.tsx", "components/hero.tsx"]}>
        Sketch a dark take on the hero.
      </Prompt>
    </Card>
  )
}

const plan = [
  ["Goals", ["Say what Northwind does in one line", "Show the live chart up top"]],
  ["Takes to try", ["A dark hero"]],
] as const

/** Write it down: a plan document on the canvas, with the prompt. */
export function DocExcerpt() {
  return (
    <Card label="A plan an agent wrote as a document on the canvas from the app’s code, with the prompt that asked for it.">
      <div className="absolute" style={{ left: 16, top: 46, width: 200 }}>
        <div className="absolute bottom-full left-0 mb-1.5 flex items-center gap-1.5 text-xs leading-none whitespace-nowrap text-muted-foreground">
          <span className="font-medium text-foreground/70">New hero plan</span>
          <span className="flex items-center gap-1">
            <WorkspaceGlyph className="size-2.5" />
            {split.title}
          </span>
        </div>
        <div className="flex h-[116px] flex-col gap-1.5 overflow-hidden border border-border bg-background p-3">
          <span className="font-heading text-[13px] leading-tight tracking-[-0.02em]">
            New hero plan
          </span>
          {plan.map(([h, items]) => (
            <div key={h} className="flex flex-col gap-0.5">
              <span className="font-heading text-[10px] tracking-[-0.02em]">{h}</span>
              {items.map((i) => (
                <span key={i} className="flex items-center gap-1 text-[8px] text-muted-foreground">
                  <span className="size-0.5 shrink-0 rounded-full bg-current" />
                  {i}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <Prompt reads={["components/hero.tsx", "app/globals.css"]}>
        Write a plan for a new hero.
      </Prompt>
    </Card>
  )
}

