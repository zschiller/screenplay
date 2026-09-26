import {
  ArrowUp,
  Braces,
  ChevronDown,
  ClipboardList,
  Crosshair,
  FilePen,
  FileText,
  Frame,
  GitBranch,
  GitPullRequest,
  Layers,
  MessageSquare,
  MousePointer2,
  PanelLeft,
  Plus,
  SquareTerminal,
} from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import {
  BoldPricing,
  BranchBadge,
  GripSpinner,
  MinimalPricing,
  PlayfulPricing,
  branchBadge,
} from "./variants"

/*
 * A faithful, static-markup rendition of the Screenplay canvas: Projects
 * sidebar on the left, the infinite canvas with live frames in the middle,
 * and the agent chat panel on the right. Rendered at 1200×720 and scaled.
 */

export const APP_WIDTH = 1200
export const APP_HEIGHT = 720

const takes = [
  { branch: "pricing-bold", color: "red", Take: BoldPricing },
  { branch: "pricing-minimal", color: "sky", Take: MinimalPricing },
  { branch: "pricing-playful", color: "amber", Take: PlayfulPricing },
] as const

export function AppWindow() {
  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-black/10 bg-background text-foreground shadow-[0_40px_120px_-30px_rgba(16,107,227,0.45),0_20px_40px_-20px_rgba(0,0,0,0.25)] dark:border-white/10"
      aria-label="The Screenplay canvas with three live variants of a pricing page"
      role="img"
    >
      {/* Title bar */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/70 bg-muted/60 px-3.5">
        <span className="size-3 rounded-full bg-[#FF5F57]" />
        <span className="size-3 rounded-full bg-[#FEBC2E]" />
        <span className="size-3 rounded-full bg-[#28C840]" />
        <span className="mr-auto ml-auto text-[11px] text-muted-foreground">
          Screenplay — Pricing exploration
        </span>
        <span className="w-12" />
      </div>

      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <Canvas />
        <ChatPanel />
      </div>
    </div>
  )
}

function Sidebar() {
  return (
    <aside className="flex w-[216px] shrink-0 flex-col border-r border-border/70 bg-sidebar text-[12px]">
      <div className="flex h-11 items-center px-3 text-muted-foreground">
        <PanelLeft className="size-4" />
      </div>
      <SectionTitle label="Projects" icon={<Plus className="size-3.5" />} />
      <div className="px-2">
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5 font-medium">
          <span className="grid size-4 place-items-center rounded bg-foreground text-[8px] font-bold text-background">
            a
          </span>
          acme-web
        </div>
        <div className="ml-3 flex flex-col border-l border-border/70 pl-2">
          <WorkspaceRow name="main" color="emerald" />
          {takes.map((t, i) => (
            <WorkspaceRow
              key={t.branch}
              name={t.branch}
              color={t.color}
              running
              active={i === 0}
            />
          ))}
          <div className="mt-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground">
            <Plus className="size-3.5" /> New Workspace
          </div>
        </div>
      </div>
      <SectionTitle
        label="Canvas"
        icon={<Layers className="size-3.5" />}
        className="mt-4"
      />
      <div className="flex flex-col gap-0.5 px-2 text-muted-foreground">
        {takes.map((t) => (
          <div
            key={t.branch}
            className="flex items-center gap-2 rounded-md px-2 py-1"
          >
            <Frame className="size-3.5" />
            <span className="truncate">{t.branch} · /pricing</span>
          </div>
        ))}
        <div className="flex items-center gap-2 rounded-md px-2 py-1">
          <FileText className="size-3.5" />
          Pricing brief
        </div>
      </div>
    </aside>
  )
}

function SectionTitle({
  label,
  icon,
  className,
}: {
  label: string
  icon: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-4 pb-1 text-[11px] font-medium text-muted-foreground",
        className
      )}
    >
      {label}
      {icon}
    </div>
  )
}

function WorkspaceRow({
  name,
  color,
  running,
  active,
}: {
  name: string
  color: keyof typeof branchBadge
  running?: boolean
  active?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5",
        active && "bg-sidebar-accent"
      )}
    >
      <GitBranch className="size-3.5 text-muted-foreground" />
      <BranchBadge name={name} color={color} className="truncate" />
      {running ? (
        <GripSpinner className="ml-auto text-muted-foreground" />
      ) : null}
    </div>
  )
}

function Canvas() {
  return (
    <div className="relative min-w-0 flex-1 overflow-hidden bg-muted/40 [background-image:radial-gradient(var(--dot)_1px,transparent_1px)] [background-size:18px_18px]">
      {/* Breadcrumb pill */}
      <div className="absolute top-3 left-3 flex h-9 items-center gap-1.5 rounded-lg bg-background px-3 text-[12px] shadow-md outline outline-1 outline-foreground/5">
        <span className="text-muted-foreground">All files</span>
        <span className="text-muted-foreground/60">/</span>
        <span className="font-medium">Pricing exploration</span>
      </div>
      {/* Follow avatars + share */}
      <div className="absolute top-3 right-3 flex h-9 items-center gap-2 rounded-lg bg-background pr-1 pl-2 shadow-md outline outline-1 outline-foreground/5">
        <div className="flex -space-x-1.5">
          {["#EC4899", "#10B981", "#106BE3"].map((c, i) => (
            <span
              key={c}
              className="grid size-6 place-items-center rounded-full border-2 border-background text-[9px] font-semibold text-white"
              style={{ background: c }}
            >
              {["M", "J", "Z"][i]}
            </span>
          ))}
        </div>
        <span className="rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background">
          Share
        </span>
      </div>

      {/* Frames */}
      <div className="absolute top-[76px] left-[24px] flex gap-6">
        {takes.map(({ branch, color, Take }, i) => (
          <div
            key={branch}
            className="frame-in relative"
            style={{ animationDelay: `${300 + i * 450}ms` }}
          >
            <div className="mb-1.5 flex items-center gap-1.5">
              <BranchBadge name={branch} color={color} />
              <span className="rounded bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                /pricing
              </span>
              {i === 1 ? (
                <Braces className="size-3 text-muted-foreground" />
              ) : null}
            </div>
            <div
              className={cn(
                "relative h-[280px] w-[196px] overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-black/5",
                i === 0 &&
                  "outline outline-2 outline-offset-2 outline-[#d946ef]"
              )}
            >
              <div
                className="frame-build absolute inset-0"
                style={{ animationDelay: `${300 + i * 450}ms` }}
              >
                <Take />
              </div>
              <div
                className="frame-skeleton absolute inset-0 flex flex-col gap-2 bg-white p-5"
                style={{ animationDelay: `${300 + i * 450}ms` }}
              >
                <span className="h-2 w-10 rounded bg-zinc-200" />
                <span className="mt-5 h-5 w-4/5 rounded bg-zinc-200" />
                <span className="h-5 w-3/5 rounded bg-zinc-200" />
                <span className="mt-4 h-28 w-full rounded bg-zinc-100" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Markdown layer */}
      <div
        className="frame-in absolute top-[420px] left-[24px] w-[300px] rounded-md bg-background p-4 text-[11px] shadow-sm ring-1 ring-foreground/5"
        style={{ animationDelay: "1800ms" }}
      >
        <div className="text-[13px] font-semibold">Pricing brief</div>
        <p className="mt-1.5 leading-relaxed text-muted-foreground">
          Goal: lift Pro upgrades. Three directions, then pick one by Friday.
        </p>
        <div className="mt-2 flex items-center gap-1.5 text-muted-foreground">
          <span className="size-3 rounded-sm border border-foreground/30" />
          <span className="relative">
            Compare on mobile
            <span className="absolute inset-x-0 bottom-0 h-1.5 bg-yellow-300/40" />
          </span>
        </div>
      </div>

      {/* Multiplayer cursors */}
      <Cursor name="Maya" color="#EC4899" className="cursor-a" />
      <Cursor
        name="Jonah"
        color="#10B981"
        className="cursor-b"
        chat="ooh, the playful one"
      />

      {/* Tool dock */}
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/5">
        {[MousePointer2, Frame, FileText, MessageSquare].map((Icon, i) => (
          <span
            key={i}
            className={cn(
              "grid size-8 place-items-center rounded-md",
              i === 0
                ? "bg-foreground text-background"
                : "text-muted-foreground"
            )}
          >
            <Icon className="size-4" />
          </span>
        ))}
      </div>
    </div>
  )
}

function Cursor({
  name,
  color,
  className,
  chat,
}: {
  name: string
  color: string
  className?: string
  chat?: string
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-0 left-0 z-10",
        className
      )}
    >
      <svg width="16" height="20" viewBox="0 0 16 20" fill="none" aria-hidden>
        <path
          d="M1 1L14.5 11.5L8.2 12.3L5.3 18.8L1 1Z"
          fill={color}
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className={cn(
          "-mt-1 ml-3 inline-block px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-white shadow-sm",
          chat ? "rounded-2xl rounded-tl-none" : "rounded-full"
        )}
        style={{ background: color }}
      >
        {chat ?? name}
      </span>
    </div>
  )
}

function ChatPanel() {
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-border/70 bg-background text-[12px]">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <span className="flex items-center gap-1.5 rounded-md border border-border/70 px-1.5 py-1">
          <BranchBadge name="pricing-bold" color="red" />
          <ChevronDown className="size-3 text-muted-foreground" />
        </span>
        <span className="font-mono text-[10px]">
          <span className="text-emerald-600">+184</span>{" "}
          <span className="text-red-500">−37</span>
        </span>
        <span className="ml-auto flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px]">
          <GitPullRequest className="size-3.5 text-emerald-600" />
          Create PR
        </span>
      </div>
      <div className="flex h-9 shrink-0 items-end gap-4 border-b border-border/70 px-3 text-[11px] text-muted-foreground">
        <span className="border-b-2 border-foreground pb-2 font-medium text-foreground">
          Claude Code
        </span>
        <span className="flex items-center gap-1 pb-2">
          <SquareTerminal className="size-3.5" /> Terminal
        </span>
        <Plus className="mb-2 size-3.5" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
        <div
          className="chat-in self-end rounded-lg bg-primary px-3 py-2 text-primary-foreground"
          style={{ animationDelay: "100ms" }}
        >
          Give me three takes on the pricing page — bold, minimal, and playful.
          One workspace each.
        </div>
        <div
          className="chat-in leading-relaxed"
          style={{ animationDelay: "400ms" }}
        >
          On it. I&apos;ll branch from{" "}
          <span className="font-mono text-[11px]">main</span> and build each
          direction in its own sandbox.
        </div>
        <ToolRow
          icon={<ClipboardList className="size-3.5" />}
          verb="Plan"
          detail="3 steps · approved"
          delay={700}
        />
        <ToolRow
          icon={<GitBranch className="size-3.5" />}
          verb="Create workspaces"
          detail="pricing-bold, -minimal, -playful"
          delay={1000}
        />
        <ToolRow
          icon={<FilePen className="size-3.5" />}
          verb="Edit"
          detail="app/pricing/page.tsx"
          diff
          delay={1300}
        />
        <ToolRow
          icon={<SquareTerminal className="size-3.5" />}
          verb="Run command"
          detail="pnpm dev"
          delay={1600}
        />
        <div
          className="chat-in leading-relaxed"
          style={{ animationDelay: "2100ms" }}
        >
          All three are running on the canvas. The bold one leans on the Pro
          tier; the playful one tests a chunkier CTA. Want knobs for the accent
          color?
        </div>
      </div>

      <div className="m-3 mt-0 rounded-xl border border-border/80 p-2.5 shadow-sm">
        <div className="text-muted-foreground">Ask the agent…</div>
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted">
            Opus 4.8 <ChevronDown className="size-3" />
          </span>
          <span className="rounded-md border border-border/80 px-1.5 py-0.5">
            Plan
          </span>
          <Crosshair className="ml-1 size-3.5" />
          <span className="ml-auto grid size-6 place-items-center rounded-full bg-foreground text-background">
            <ArrowUp className="size-3.5" />
          </span>
        </div>
      </div>
    </aside>
  )
}

function ToolRow({
  icon,
  verb,
  detail,
  diff,
  delay,
}: {
  icon: React.ReactNode
  verb: string
  detail: string
  diff?: boolean
  delay: number
}) {
  return (
    <div
      className="chat-in flex items-center gap-2 rounded-md border border-border/80 bg-muted/50 px-2 py-1.5 text-[11px]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="font-medium">{verb}</span>
      <span className="truncate font-mono text-[10px] text-muted-foreground">
        {detail}
      </span>
      {diff ? (
        <span className="ml-auto shrink-0 font-mono text-[10px]">
          <span className="text-emerald-600">+84</span>{" "}
          <span className="text-red-500">−12</span>
        </span>
      ) : null}
    </div>
  )
}
