import {
  Braces,
  Check,
  ChevronDown,
  Crosshair,
  HardDrive,
  Laptop,
  MessageSquare,
  MousePointer2,
  Smartphone,
  Tablet,
} from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { BoldPricing, BranchBadge, PlayfulPricing } from "./variants"
import { ScaleToFit } from "./scale-to-fit"
import { SectionHeading } from "./section-heading"

export function Features() {
  return (
    <section
      id="features"
      className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 py-24 sm:px-8 sm:py-32"
    >
      <SectionHeading
        slug="Int. The writers' room — continuous"
        title="Everything a canvas needs to direct a room full of agents."
      />
      <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Real sandboxes, not screenshots"
          body="Every frame is a live dev server on its own branch. Click, scroll, fill in forms, flip to mobile — it's the actual app."
        >
          <SandboxVisual />
        </Card>
        <Card
          title="Multiplayer by default"
          body="Deploy the web app and share a link. Everyone sees the same canvas, cursors, comments and running branches. Follow a teammate with one click."
        >
          <MultiplayerVisual />
        </Card>
        <Card
          title="Point at anything"
          body="Hit ⌘E, click an element in any frame, and send it to the agent. No more “the button, no, the other button.”"
        >
          <TargetVisual />
        </Card>
        <Card
          className="lg:col-span-2"
          title="Knobs: tune every take at once"
          body="Your agent exposes spacing, color and copy as knobs with @screenplay.space/knobs. Drag a slider and watch every branch respond — no re-prompting."
        >
          <KnobsVisual />
        </Card>
        <Card
          title="Bring your own harness"
          body="Run Claude Code, Codex or opencode with the models you already pay for. Switch models per chat."
        >
          <HarnessVisual />
        </Card>
        <Card
          title="Shared state across frames"
          body="With @screenplay.space/state, step through checkout once and every frame — and every viewer — follows along."
        >
          <StateVisual />
        </Card>
        <Card
          title="Local-first on your Mac"
          body="The desktop app runs entirely offline: git worktrees for sandboxes, your installed CLIs for agents. Your code stays put."
        >
          <LocalVisual />
        </Card>
      </div>
    </section>
  )
}

function Card({
  title,
  body,
  children,
  className,
}: {
  title: string
  body: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-sm transition-shadow hover:shadow-md",
        className
      )}
    >
      <div className="relative flex h-60 items-center justify-center overflow-hidden border-b border-border/70 bg-muted/40 [background-image:radial-gradient(var(--dot)_1px,transparent_1px)] [background-size:14px_14px]">
        {children}
      </div>
      <div className="p-6">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
    </div>
  )
}

function SandboxVisual() {
  return (
    <div className="flex items-end gap-5">
      {[
        { Icon: Laptop, w: 280, h: 184, label: "Desktop" },
        { Icon: Tablet, w: 120, h: 186, label: "Tablet" },
        { Icon: Smartphone, w: 80, h: 172, label: "Mobile" },
      ].map(({ Icon, w, h, label }, i) => (
        <div
          key={label}
          className={cn(
            "flex flex-col gap-1.5 transition-transform duration-500",
            i === 0 ? "max-sm:hidden" : ""
          )}
          style={{ transitionDelay: `${i * 60}ms` }}
        >
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Icon className="size-3" /> {label}
          </span>
          <div
            className="overflow-hidden rounded-sm bg-white shadow-md ring-1 ring-black/5 transition-transform duration-300 group-hover:-translate-y-1"
            style={{ width: w, height: h - 40 }}
          >
            <ScaleToFit
              width={w < 150 ? 196 : 300}
              height={w < 150 ? ((h - 40) / w) * 196 : ((h - 40) / w) * 300}
            >
              {i === 1 ? <PlayfulPricing /> : <BoldPricing />}
            </ScaleToFit>
          </div>
        </div>
      ))}
    </div>
  )
}

function MultiplayerVisual() {
  return (
    <div className="relative h-full w-full">
      <div className="absolute top-8 left-1/2 h-32 w-44 -translate-x-1/2 rounded-sm bg-white shadow-md ring-1 ring-black/5">
        <div className="m-3 h-2 w-16 rounded bg-zinc-200" />
        <div className="mx-3 h-2 w-24 rounded bg-zinc-100" />
        <div className="mx-3 mt-4 h-10 rounded bg-zinc-100" />
      </div>
      <span className="absolute top-6 left-[62%] grid size-6 place-items-center rounded-full rounded-bl-none bg-[#FFC53D] text-[10px] font-bold text-[#3D2A00] shadow ring-2 ring-white">
        3
      </span>
      <MiniCursor
        color="#EC4899"
        name="Maya"
        className="mp-cursor-a top-24 left-[18%]"
      />
      <MiniCursor
        color="#10B981"
        name="Jonah"
        className="mp-cursor-b top-36 left-[58%]"
      />
      <MiniCursor
        color="#9B7BFF"
        name="Priya"
        className="mp-cursor-c top-14 left-[70%]"
      />
      <div className="absolute bottom-4 left-4 flex items-center gap-1.5 rounded-full bg-background py-1 pr-2.5 pl-1 text-[10px] shadow ring-1 ring-foreground/5">
        <span className="grid size-5 place-items-center rounded-full bg-[#10B981] text-[9px] font-semibold text-white">
          J
        </span>
        Following Jonah
      </div>
      <MessageSquare className="absolute right-5 bottom-5 size-4 text-muted-foreground" />
    </div>
  )
}

function MiniCursor({
  color,
  name,
  className,
}: {
  color: string
  name: string
  className?: string
}) {
  return (
    <div className={cn("absolute", className)}>
      <MousePointer2
        className="size-4 drop-shadow"
        style={{ color, fill: color }}
      />
      <span
        className="ml-3 inline-block rounded-full px-1.5 py-px text-[10px] font-medium text-white"
        style={{ background: color }}
      >
        {name}
      </span>
    </div>
  )
}

function TargetVisual() {
  return (
    <div className="relative w-52 rounded-sm bg-white p-3 text-zinc-900 shadow-md ring-1 ring-black/5">
      <div className="h-2 w-12 rounded bg-zinc-200" />
      <div className="mt-3 text-[13px] font-semibold">Upgrade to Pro</div>
      <div className="mt-1 h-1.5 w-32 rounded bg-zinc-100" />
      <div className="relative mt-4 inline-block">
        <span className="target-ring absolute -inset-1 rounded-md border-2 border-[#0ea5e9] bg-[#0ea5e9]/10" />
        <span className="relative block rounded-md bg-zinc-900 px-3 py-1.5 text-[11px] font-medium text-white">
          Start free trial
        </span>
        <span className="target-chip absolute top-full left-0 mt-3 flex items-center gap-1 rounded-md bg-foreground px-2 py-1 text-[10px] font-medium whitespace-nowrap text-background shadow-lg">
          <Crosshair className="size-3" /> Send to agent
        </span>
        <MousePointer2 className="target-pointer absolute -right-3 -bottom-3 size-4 fill-white text-zinc-900" />
      </div>
    </div>
  )
}

function KnobsVisual() {
  return (
    <div className="flex w-full items-center justify-center gap-6 px-4 sm:px-6">
      <div className="w-48 shrink-0 rounded-xl bg-background p-3 text-[11px] shadow-lg ring-1 ring-foreground/5 max-sm:hidden">
        <div className="mb-3 flex items-center justify-between font-medium">
          Knobs{" "}
          <span className="font-mono text-[10px] text-muted-foreground">3</span>
        </div>
        <div className="flex items-center justify-between text-muted-foreground">
          Radius
          <span className="font-mono text-foreground">
            <span className="knob-radius-value" />
            px
          </span>
        </div>
        <div className="relative mt-2 h-1.5 rounded-full bg-muted">
          <div className="knob-fill absolute inset-y-0 left-0 w-[14%] rounded-full bg-[#106BE3]" />
          <div className="knob-thumb absolute top-1/2 left-[14%] size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#106BE3] bg-white shadow" />
        </div>
        <div className="mt-4 flex items-center justify-between text-muted-foreground">
          Headline
          <ChevronDown className="size-3" />
        </div>
        <div className="mt-1.5 truncate rounded-md border border-border px-2 py-1 text-foreground">
          <span className="knob-headline-text" />
        </div>
        <div className="mt-3 flex items-center justify-between text-muted-foreground">
          Accent
          <span className="flex gap-1">
            <span className="size-3.5 rounded-full bg-[#106BE3] ring-2 ring-[#106BE3]/30" />
            <span className="size-3.5 rounded-full bg-[#FF7A59]" />
            <span className="size-3.5 rounded-full bg-[#2FCB8F]" />
          </span>
        </div>
      </div>
      <div className="flex gap-2 sm:gap-3">
        {(["red", "sky", "amber"] as const).map((color, i) => (
          <div key={color} className="flex flex-col gap-1.5">
            <BranchBadge
              name={`take-${i + 1}`}
              color={color}
              className="self-start text-[9px]"
            />
            <div
              className={cn(
                "flex h-36 w-[88px] flex-col p-3 shadow-sm ring-1 ring-black/5 sm:w-28",
                i === 0
                  ? "bg-[#0B0D12] text-white"
                  : i === 1
                    ? "bg-white text-zinc-900"
                    : "bg-[#FFE9A8] text-[#2B1D00]"
              )}
            >
              <div className="knob-headline-bar h-2 rounded bg-current opacity-80" />
              <div className="mt-1.5 h-1.5 w-3/5 rounded bg-current opacity-20" />
              <div className="knob-card-radius mt-auto bg-[#106BE3] py-1.5 text-center text-[9px] font-medium text-white">
                Get started
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HarnessVisual() {
  const groups = [
    { harness: "Claude Code", models: ["Opus 4.8", "Sonnet 5"], active: 0 },
    { harness: "Codex", models: ["GPT-5.5"] },
    { harness: "opencode", models: ["AI Gateway"] },
  ]
  return (
    <div className="w-56 rounded-xl bg-background p-1.5 text-[11px] shadow-lg ring-1 ring-foreground/5">
      {groups.map((g) => (
        <div key={g.harness} className="py-0.5">
          <div className="px-2 pt-1 pb-0.5 text-[10px] font-medium text-muted-foreground">
            {g.harness}
          </div>
          {g.models.map((m, i) => (
            <div
              key={m}
              className={cn(
                "flex items-center justify-between rounded-md px-2 py-1",
                g.active === i && "bg-muted font-medium"
              )}
            >
              {m}
              {g.active === i ? <Check className="size-3" /> : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function StateVisual() {
  return (
    <div className="flex gap-3">
      {(["sky", "violet"] as const).map((color, i) => (
        <div key={color} className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1">
            <BranchBadge
              name={i === 0 ? "checkout-a" : "checkout-b"}
              color={color}
              className="text-[9px]"
            />
            <span className="flex items-center gap-0.5 rounded bg-muted px-1 font-mono text-[9px] text-muted-foreground">
              <Braces className="size-2.5" />
            </span>
          </span>
          <div
            className={cn(
              "w-32 p-3 shadow-sm ring-1 ring-black/5",
              i === 0
                ? "rounded-sm bg-white text-zinc-900"
                : "rounded-lg bg-[#1E1B2E] text-white"
            )}
          >
            <div className="text-[9px] opacity-60">Checkout</div>
            <div className="relative mt-3 flex items-center justify-between">
              <div className="absolute inset-x-1 top-1/2 h-0.5 -translate-y-1/2 bg-current opacity-15" />
              <div className="state-stepper-fill absolute top-1/2 left-1 h-0.5 -translate-y-1/2 bg-[#106BE3]" />
              {[0, 1, 2, 3].map((d) => (
                <span
                  key={d}
                  className={`state-stepper-dot-${d} relative size-2.5 rounded-full border-2`}
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--card)",
                  }}
                />
              ))}
            </div>
            <div className="mt-3 font-mono text-[10px]">
              step: <span className="state-step-label text-[#5EA0FF]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function LocalVisual() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-2 rounded-xl bg-background px-3 py-2 text-[11px] shadow-lg ring-1 ring-foreground/5">
        <HardDrive className="size-4 text-muted-foreground" />
        <span className="font-mono">~/code/acme-web</span>
      </div>
      <div className="flex flex-col gap-1 font-mono text-[10px] text-muted-foreground">
        {[
          ".worktrees/pricing-bold",
          ".worktrees/pricing-minimal",
          ".worktrees/pricing-playful",
        ].map((p) => (
          <span key={p} className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {p}
          </span>
        ))}
      </div>
      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
        Offline · no account needed
      </span>
    </div>
  )
}
