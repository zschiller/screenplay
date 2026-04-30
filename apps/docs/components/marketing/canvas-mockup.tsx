export function CanvasMockup() {
  return (
    <div className="relative isolate aspect-[5/4] w-full overflow-hidden rounded-2xl border border-border bg-muted/30">
      <CanvasGrid />

      <Artboard
        label="onboarding.tsx"
        route="/welcome"
        branch="feat/onboarding"
        branchClass="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
        hmr="connected"
        className="absolute left-[6%] top-[16%] h-[42%] w-[34%]"
      >
        <FakeUI variant="form" />
      </Artboard>

      <Artboard
        label="dashboard.tsx"
        route="/"
        branch="main"
        branchClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
        hmr="connected"
        showButtons
        className="absolute right-[6%] top-[14%] h-[40%] w-[40%]"
      >
        <FakeUI variant="cards" />
      </Artboard>

      <Artboard
        label="settings.tsx"
        route="/settings"
        branch="fix/auth"
        branchClass="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
        hmr="reconnecting"
        className="absolute bottom-[8%] left-[22%] h-[36%] w-[42%]"
      >
        <FakeUI variant="list" />
      </Artboard>

      <Cursor className="cursor-a" name="Maya" color="#106BE3" />
      <Cursor className="cursor-b" name="Jules" color="#10B981" />

      <CommentPin className="absolute right-[12%] top-[20%]" />
    </div>
  )
}

function CanvasGrid() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 opacity-60"
      style={{
        backgroundImage:
          "radial-gradient(circle, var(--border) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      }}
    />
  )
}

const HMR_DOT_COLOR = {
  connected: "bg-green-500",
  reconnecting: "bg-yellow-500",
  disconnected: "bg-red-500",
} as const

function Artboard({
  label,
  route,
  branch,
  branchClass,
  hmr,
  className,
  showButtons,
  children,
}: {
  label: string
  route: string
  branch: string
  branchClass: string
  hmr: keyof typeof HMR_DOT_COLOR
  className?: string
  showButtons?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className={`absolute ${className ?? ""}`}>
      {/* Label stack — sits above the frame, mirrors the real app's
          ArtboardLabel (branch badge → HMR dot + name + route pill). */}
      <div className="absolute bottom-full left-0 mb-1 flex flex-col items-start whitespace-nowrap">
        <span
          className={`mb-0.5 inline-flex max-w-[12rem] items-center rounded-md px-1.5 py-0 font-mono text-[10px] ${branchClass}`}
        >
          <span className="truncate">{branch}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ring-1 ring-background ${HMR_DOT_COLOR[hmr]}`}
          />
          <span className="text-[11px] font-medium text-foreground/70">
            {label}
          </span>
          <span className="rounded-md bg-muted px-1.5 py-0 font-mono text-[10px] text-foreground/50">
            {route}
          </span>
        </div>
      </div>

      {/* Action buttons — above the frame, on the right. */}
      {showButtons && (
        <div className="absolute right-0 bottom-full mb-1 flex h-5 items-center gap-0.5">
          <ArtboardButton>
            <MousePointerIcon />
          </ArtboardButton>
          <ArtboardButton>
            <SlidersIcon />
          </ArtboardButton>
          <ArtboardButton>
            <PlayIcon />
          </ArtboardButton>
        </div>
      )}

      {/* The frame itself: clean iframe-style container, no chrome bar. */}
      <div className="h-full w-full overflow-hidden rounded-md border border-border bg-white shadow-sm dark:bg-zinc-900">
        <div className="h-full w-full p-2">{children}</div>
      </div>
    </div>
  )
}

function ArtboardButton({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex size-5 items-center justify-center rounded-md border border-border bg-card text-foreground/70 shadow-sm">
      {children}
    </span>
  )
}

function FakeUI({ variant }: { variant: "form" | "cards" | "list" }) {
  if (variant === "form") {
    return (
      <div className="flex h-full flex-col gap-1.5">
        {/* Page title block */}
        <div className="h-2 w-2/3 rounded bg-foreground/80" />
        <div className="h-1.5 w-3/4 rounded bg-muted-foreground/40" />
        {/* Inputs */}
        <div className="mt-1 space-y-1">
          <div className="h-1 w-1/4 rounded bg-muted-foreground/30" />
          <div className="h-3.5 rounded-md border border-border bg-background" />
        </div>
        <div className="space-y-1">
          <div className="h-1 w-1/3 rounded bg-muted-foreground/30" />
          <div className="h-3.5 rounded-md border border-border bg-background" />
        </div>
        {/* Primary button */}
        <div className="mt-auto h-4 w-1/3 rounded-md bg-[#106BE3]" />
      </div>
    )
  }
  if (variant === "cards") {
    return (
      <div className="flex h-full flex-col gap-1.5">
        {/* Top app bar */}
        <div className="flex items-center justify-between rounded-md bg-muted/60 px-1.5 py-1">
          <div className="flex items-center gap-1">
            <div className="size-1.5 rounded-sm bg-[#106BE3]" />
            <div className="h-1.5 w-8 rounded bg-foreground/60" />
          </div>
          <div className="size-2 rounded-full bg-muted-foreground/40" />
        </div>
        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-1.5">
          <div className="rounded-md border border-border bg-background p-1.5">
            <div className="h-1 w-1/2 rounded bg-muted-foreground/40" />
            <div className="mt-1 h-2.5 w-2/3 rounded bg-foreground/80" />
            <div className="mt-1 h-1 w-1/3 rounded bg-emerald-500/60" />
          </div>
          <div className="rounded-md border border-border bg-background p-1.5">
            <div className="h-1 w-1/2 rounded bg-muted-foreground/40" />
            <div className="mt-1 h-2.5 w-1/2 rounded bg-foreground/80" />
            <div className="mt-1 h-1 w-1/4 rounded bg-[#106BE3]/60" />
          </div>
        </div>
        {/* Bar chart card */}
        <div className="flex-1 rounded-md border border-border bg-background p-1.5">
          <div className="mb-1 h-1 w-1/3 rounded bg-muted-foreground/40" />
          <div className="flex h-[calc(100%-0.5rem)] items-end gap-1">
            <div className="h-[40%] w-2 rounded-sm bg-[#106BE3]/40" />
            <div className="h-[65%] w-2 rounded-sm bg-[#106BE3]/60" />
            <div className="h-[55%] w-2 rounded-sm bg-[#106BE3]/50" />
            <div className="h-[85%] w-2 rounded-sm bg-[#106BE3]" />
            <div className="h-[60%] w-2 rounded-sm bg-[#106BE3]/60" />
            <div className="h-[75%] w-2 rounded-sm bg-[#106BE3]/80" />
            <div className="h-[45%] w-2 rounded-sm bg-[#106BE3]/50" />
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col gap-1">
      {/* Section header */}
      <div className="flex items-center justify-between pb-0.5">
        <div className="h-1.5 w-1/4 rounded bg-foreground/70" />
        <div className="h-3 w-8 rounded-md bg-[#106BE3]/80" />
      </div>
      {/* List rows */}
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-1"
        >
          <div className="size-2 shrink-0 rounded-full bg-muted-foreground/30" />
          <div className="flex flex-1 flex-col gap-0.5">
            <div className="h-1.5 w-2/5 rounded bg-foreground/70" />
            <div className="h-1 w-3/5 rounded bg-muted-foreground/30" />
          </div>
          <div className="h-2 w-4 shrink-0 rounded-sm bg-muted-foreground/30" />
        </div>
      ))}
    </div>
  )
}

function Cursor({
  className,
  name,
  color,
}: {
  className?: string
  name: string
  color: string
}) {
  return (
    <div className={`absolute pointer-events-none ${className ?? ""}`}>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
        <path
          d="M3 2L15 8.5L9.5 10L7.5 15.5L3 2Z"
          fill={color}
          stroke="white"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="absolute left-3 top-4 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm"
        style={{ backgroundColor: color }}
      >
        {name}
      </span>
    </div>
  )
}

function MousePointerIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
    </svg>
  )
}

function SlidersIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="21" y1="6" x2="14" y2="6" />
      <line x1="10" y1="6" x2="3" y2="6" />
      <line x1="21" y1="12" x2="12" y2="12" />
      <line x1="8" y1="12" x2="3" y2="12" />
      <line x1="21" y1="18" x2="16" y2="18" />
      <line x1="12" y1="18" x2="3" y2="18" />
      <circle cx="12" cy="6" r="2" fill="currentColor" />
      <circle cx="10" cy="12" r="2" fill="currentColor" />
      <circle cx="14" cy="18" r="2" fill="currentColor" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function CommentPin({ className }: { className?: string }) {
  return (
    <div
      className={`flex size-6 items-center justify-center rounded-full rounded-bl-none border-2 border-background bg-amber-500 text-[10px] font-semibold text-white shadow-md ${className ?? ""}`}
    >
      1
    </div>
  )
}
