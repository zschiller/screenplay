import {
  BroadcastIcon,
  CursorIcon,
  PencilSimpleIcon,
} from "@workspace/ui/components/icons"
import { cn } from "@workspace/ui/lib/utils"

import {
  Frame,
  FrameBar,
  UserBubble,
  WorkspaceGlyph,
  versions,
} from "./canvas"
import { Fit } from "./fit"
import { ChatHeader, ToolRow } from "./make"
import { Northwind } from "./northwind"
import {
  Cursor,
  Pin,
  ThreadCard,
  people,
} from "./team"

const [maya, sam, jo] = people
const split = versions[1]

/** The Live badge on a live frame's title line (#1580): outlined, broadcast icon, no faces. */
function LiveTag({
  className,
  style,
}: {
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span
      className={cn(
        "absolute z-[6] flex h-[18px] items-center gap-1 rounded border border-border px-1.5 text-xs font-medium whitespace-nowrap text-foreground",
        className
      )}
      style={style}
    >
      <BroadcastIcon className="size-3" />
      Live
    </span>
  )
}

/** "Agent has control", ink, with the working glyph. */
function AgentTag({ style }: { style?: React.CSSProperties }) {
  return (
    <span
      className="absolute z-[6] flex h-[18px] -translate-x-full items-center gap-1 rounded bg-foreground px-1.5 text-xs font-medium whitespace-nowrap text-background"
      style={style}
    >
      <WorkspaceGlyph state="working" className="size-3" />
      Agent has control
    </span>
  )
}

/** Who sent it, over a bubble on a shared canvas. */
function Sender({ name, color }: { name: string; color: string }) {
  return (
    <span className="flex items-center gap-1.5 self-end text-xs text-muted-foreground">
      <span
        className="flex size-4 items-center justify-center rounded-full text-[10px] font-medium text-neutral-950"
        style={{ backgroundColor: color }}
      >
        {name[0]}
      </span>
      {name}
    </span>
  )
}

/* ---------- For teams, option B: a picture per perk ---------- */

function PerkCard({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <Fit
      width={400}
      height={272}
      role="img"
      aria-label={label}
      className="bg-plane border border-border text-foreground"
    >
      <div className="[container-type:inline-size] relative size-full">
        {children}
      </div>
    </Fit>
  )
}

export function PerkLive() {
  return (
    <PerkCard label="A frame gone live: the Live badge on its title line, Go live pressed in its bar, two teammates’ cursors on it.">
      <Frame
        label="Home"
        workspace={split.title}
        selected
        style={{ left: 40, top: 36, width: 280 }}
      >
        <Northwind version={split.version} />
      </Frame>
      <LiveTag style={{ left: 320, top: 14 }} className="-translate-x-full" />
      <FrameBar live className="z-[5]" style={{ left: 40, top: 220, width: 280 }} />
      <Cursor name="Maya" color={maya.color} style={{ left: 200, top: 110 }} />
      <Cursor name="Jo" color={jo.color} style={{ left: 90, top: 150 }} />
    </PerkCard>
  )
}

export function PerkAgent() {
  return (
    <PerkCard label="The agent with control of a shared frame, its cursor on the sign-up button.">
      <Frame
        label="Home"
        workspace={split.title}
        selected
        fadeHandles
        style={{ left: 40, top: 36, width: 260 }}
      >
        <Northwind version={split.version} />
      </Frame>
      <AgentTag style={{ left: 300, top: 14 }} />
      <div className="absolute top-[212px] left-[40px] flex w-[300px] flex-col gap-1.5">
        <ToolRow icon={<CursorIcon />} verb="Click" detail="Start free trial" />
        <ToolRow icon={<PencilSimpleIcon />} verb="Type" detail="“maya@northwind.com”" />
      </div>
    </PerkCard>
  )
}

export function PerkComments() {
  return (
    <PerkCard label="A comment pinned to the sign-up button, its thread open beside it.">
      <Frame
        label="Home"
        workspace="Gradient headline"
        style={{ left: 16, top: 36, width: 220 }}
      >
        <Northwind version="gradient" />
      </Frame>
      <div className="absolute z-[7]" style={{ left: 104, top: 128 }}>
        <div className="absolute bottom-0 left-0">
          <Pin number={1} />
        </div>
        <ThreadCard className="top-[-92px] left-[34px] scale-[0.92] origin-top-left" />
      </div>
    </PerkCard>
  )
}

export function PerkChat() {
  return (
    <PerkCard label="A shared chat naming who sent each message.">
      <div className="absolute inset-0 flex flex-col bg-background">
        <ChatHeader title={split.title} crumb={false} />
        <div className="flex flex-col gap-2.5 px-3 py-3 text-xs leading-normal">
          <div className="flex flex-col gap-1">
            <Sender name="Maya" color={maya.color} />
            <UserBubble>Can the chart sit a little higher?</UserBubble>
          </div>
          <p>Moved it up so it lines up with the headline.</p>
          <div className="flex flex-col gap-1">
            <Sender name="Sam" color={sam.color} />
            <UserBubble>Looks right. Open the pull request.</UserBubble>
          </div>
        </div>
      </div>
    </PerkCard>
  )
}
