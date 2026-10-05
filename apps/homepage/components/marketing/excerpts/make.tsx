import {
  ArrowUpIcon,
  DotsThreeIcon,
  FileTextIcon,
  GitPullRequestIcon,
  SidebarSimpleIcon,
} from "@workspace/ui/components/icons"
import { cn } from "@workspace/ui/lib/utils"

import { Diff, Frame, FrameBar, Tool, UserBubble, versions } from "./canvas"
import { Fit } from "./fit"
import { Northwind } from "./northwind"
import { Card } from "./steps"

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
            Create PR
          </span>
        ) : null}
      </span>
    </div>
  )
}

/** Ship it: the built take's chat, Create PR in its header. */
export function PrHeaderExcerpt() {
  return (
    <Fit
      width={320}
      height={256}
      role="img"
      aria-label="The Dark hero chat, with Create PR in its header."
      className="border border-border bg-background text-foreground"
    >
      <div className="flex size-full flex-col">
        <ChatHeader title={dark.title} crumb={false} />
        <div className="flex flex-col gap-3 px-3 py-3 text-xs leading-normal">
          <p>
            The hero sits on a dark background now, with a soft accent glow
            behind the chart.
          </p>
          <UserBubble>
            Make the glow a little softer, then it’s good.
          </UserBubble>
          <p>Done. The glow is half as strong.</p>
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

/* ---------- Plan it, Sketch it, Build it ---------- */

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
      <UserBubble className="ml-0 px-2.5 py-1.5 text-xs">{children}</UserBubble>
      {reads.map((file) => (
        <ToolRow key={file} icon={<FileTextIcon />} verb="Read" detail={file} />
      ))}
    </div>
  )
}

const gradient = versions[0]

/** Sketch it: two mockups a chat drew from the app’s own code, side by side
 * to compare before either is built. */
export function SketchExcerpt() {
  return (
    <Card label="Two mockups an agent sketched from the app’s own code, a dark hero and a gradient headline, side by side to compare, with the prompt that asked for them.">
      <Frame
        label="Take A · Dark hero"
        selected
        style={{ left: 16, top: 46, width: 138 }}
      >
        <Northwind version={dark.version} />
      </Frame>
      <Frame
        label="Take B · Gradient"
        style={{ left: 166, top: 46, width: 138 }}
      >
        <Northwind version={gradient.version} />
      </Frame>
      <Prompt reads={["app/page.tsx", "components/hero.tsx"]}>
        Sketch two takes on the hero.
      </Prompt>
    </Card>
  )
}

/** Build it: the picked take built and running in a frame of its own, its
 * page bar under it, the other versions’ frames on either side. */
export function BuildExcerpt() {
  return (
    <Card label="The dark hero built and running live in its own frame, with its page bar, between the other versions’ frames.">
      {/* The neighbours, cut off at the card’s edges. */}
      <Frame label="Home" style={{ left: -230, top: 46, width: 256 }}>
        <Northwind version={gradient.version} />
      </Frame>
      <Frame label="Home" style={{ left: 302, top: 46, width: 256 }}>
        <Northwind version={split.version} />
      </Frame>
      <Frame
        label="Home"
        workspace={dark.title}
        working
        selected
        style={{ left: 32, top: 46, width: 256 }}
      >
        <Northwind version={dark.version} />
      </Frame>
      <FrameBar style={{ left: 32, top: 210, width: 256 }} />
    </Card>
  )
}

const plan = [
  [
    "Goals",
    [
      "Say what Northwind does in one line",
      "Put the live chart up top",
      "Keep the trial button first",
    ],
  ],
  ["Takes to try", ["A dark hero with a soft glow", "A gradient headline"]],
] as const

/** Plan it: a plan document open on the canvas, the page it plans beside it. */
export function DocExcerpt() {
  return (
    <Card label="A plan an agent wrote as a document on the canvas, beside the page it plans.">
      <div className="absolute" style={{ left: 16, top: 46, width: 212 }}>
        <div className="absolute bottom-full left-0 mb-1.5 text-xs leading-none font-medium whitespace-nowrap text-foreground/70">
          New hero plan
        </div>
        <div className="flex h-[194px] flex-col gap-2.5 overflow-hidden border border-border bg-background px-3.5 py-3">
          <span className="font-heading text-[15px] leading-tight tracking-[-0.02em]">
            New hero plan
          </span>
          {plan.map(([h, items]) => (
            <div key={h} className="flex flex-col gap-1">
              <span className="font-heading text-[11px] tracking-[-0.02em]">
                {h}
              </span>
              {items.map((i) => (
                <span
                  key={i}
                  className="flex items-center gap-1.5 text-[10px] whitespace-nowrap text-muted-foreground"
                >
                  <span className="size-[3px] shrink-0 rounded-full bg-current" />
                  {i}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <Frame label="Home" style={{ left: 240, top: 46, width: 136 }}>
        <Northwind />
      </Frame>
    </Card>
  )
}
