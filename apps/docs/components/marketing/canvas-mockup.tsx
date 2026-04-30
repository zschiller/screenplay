export function CanvasMockup() {
  return (
    <div className="relative isolate aspect-[5/4] w-full overflow-hidden rounded-2xl border border-border bg-muted/30">
      <CanvasGrid />

      <Artboard
        title="onboarding.tsx"
        className="absolute left-[8%] top-[12%] h-[42%] w-[36%]"
      >
        <FakeUI variant="form" />
      </Artboard>

      <Artboard
        title="dashboard.tsx"
        className="absolute right-[8%] top-[10%] h-[38%] w-[40%]"
        live
      >
        <FakeUI variant="cards" />
      </Artboard>

      <Artboard
        title="settings.tsx"
        className="absolute bottom-[10%] left-[20%] h-[36%] w-[44%]"
      >
        <FakeUI variant="list" />
      </Artboard>

      <Cursor className="cursor-a" name="Maya" color="#106BE3" />
      <Cursor className="cursor-b" name="Jules" color="#10B981" />

      <CommentPin className="absolute right-[14%] top-[18%]" />
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

function Artboard({
  title,
  className,
  children,
  live,
}: {
  title: string
  className?: string
  children?: React.ReactNode
  live?: boolean
}) {
  return (
    <div
      className={`flex flex-col rounded-lg border border-border bg-card shadow-sm ${className ?? ""}`}
    >
      <div className="flex items-center justify-between border-b border-border/70 px-2.5 py-1.5">
        <span className="font-mono text-[10px] text-muted-foreground">
          {title}
        </span>
        {live ? (
          <span className="flex items-center gap-1">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
            </span>
            <span className="font-mono text-[9px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              live
            </span>
          </span>
        ) : (
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
            sandbox
          </span>
        )}
      </div>
      <div className="flex-1 overflow-hidden p-2">{children}</div>
    </div>
  )
}

function FakeUI({ variant }: { variant: "form" | "cards" | "list" }) {
  if (variant === "form") {
    return (
      <div className="flex h-full flex-col gap-1.5">
        <div className="h-2 w-1/2 rounded bg-foreground/80" />
        <div className="h-1.5 w-3/4 rounded bg-muted-foreground/40" />
        <div className="mt-1 h-4 rounded border border-border bg-background" />
        <div className="h-4 rounded border border-border bg-background" />
        <div className="mt-auto h-4 w-1/3 rounded bg-[#106BE3]" />
      </div>
    )
  }
  if (variant === "cards") {
    return (
      <div className="grid h-full grid-cols-2 gap-1.5">
        <div className="rounded border border-border bg-background p-1.5">
          <div className="h-1.5 w-1/2 rounded bg-foreground/70" />
          <div className="mt-1 h-3 w-2/3 rounded bg-[#106BE3]/20" />
        </div>
        <div className="rounded border border-border bg-background p-1.5">
          <div className="h-1.5 w-1/2 rounded bg-foreground/70" />
          <div className="mt-1 h-3 w-1/2 rounded bg-emerald-500/20" />
        </div>
        <div className="col-span-2 rounded border border-border bg-background p-1.5">
          <div className="flex items-end gap-1">
            <div className="h-3 w-2 rounded-sm bg-[#106BE3]/40" />
            <div className="h-5 w-2 rounded-sm bg-[#106BE3]/60" />
            <div className="h-4 w-2 rounded-sm bg-[#106BE3]/50" />
            <div className="h-7 w-2 rounded-sm bg-[#106BE3]" />
            <div className="h-5 w-2 rounded-sm bg-[#106BE3]/60" />
            <div className="h-6 w-2 rounded-sm bg-[#106BE3]/80" />
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded border border-border bg-background px-1.5 py-1"
        >
          <div className="h-1.5 w-1/3 rounded bg-foreground/60" />
          <div className="h-2 w-6 rounded bg-muted-foreground/30" />
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

function CommentPin({ className }: { className?: string }) {
  return (
    <div
      className={`flex size-6 items-center justify-center rounded-full rounded-bl-none border-2 border-background bg-amber-500 text-[10px] font-semibold text-white shadow-md ${className ?? ""}`}
    >
      1
    </div>
  )
}
