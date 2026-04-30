export function DesignerCanvasMockup() {
  return (
    <div className="relative isolate aspect-[5/4] w-full overflow-hidden rounded-2xl border border-border bg-muted/30">
      <CanvasGrid />

      {/* The "design" — a real route running in a sandbox */}
      <Artboard
        label="Pricing"
        route="/pricing"
        branch="design/pricing-v3"
        branchClass="bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300"
        className="absolute left-[8%] top-[14%] h-[64%] w-[52%]"
        showButtons
      >
        <FakePricing />
      </Artboard>

      {/* Side-by-side variant, driven by the same component with different knobs */}
      <Artboard
        label="Pricing — dark"
        route="/pricing"
        branch="design/pricing-v3"
        branchClass="bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300"
        className="absolute right-[6%] top-[10%] h-[42%] w-[34%]"
      >
        <FakePricing dark />
      </Artboard>

      {/* Floating knobs panel */}
      <div className="absolute bottom-[8%] right-[6%] w-[34%] rounded-md border border-border bg-card p-2 shadow-md">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] font-medium text-foreground/80">
            Hero copy
          </span>
          <span className="rounded bg-muted px-1 py-0 font-mono text-[8px] text-muted-foreground">
            text
          </span>
        </div>
        <div className="mb-2 h-3 rounded border border-border bg-background" />
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-medium text-foreground/80">
            Accent
          </span>
          <span className="font-mono text-[9px] text-muted-foreground">
            #106BE3
          </span>
        </div>
        <div className="flex gap-1">
          <span className="size-3 rounded-sm border border-border bg-[#106BE3] ring-1 ring-[#106BE3]/40" />
          <span className="size-3 rounded-sm border border-border bg-emerald-500" />
          <span className="size-3 rounded-sm border border-border bg-amber-500" />
          <span className="size-3 rounded-sm border border-border bg-rose-500" />
          <span className="size-3 rounded-sm border border-border bg-violet-500" />
        </div>
      </div>

      {/* Multiplayer cursors — designer + reviewer */}
      <Cursor className="cursor-a" name="Maya · design" color="#106BE3" />
      <Cursor className="cursor-b" name="Jules · pm" color="#E0457B" />

      {/* Comment thread anchored to a button */}
      <CommentThread className="absolute right-[42%] top-[36%]">
        Can we try a softer accent here?
      </CommentThread>
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
  label,
  route,
  branch,
  branchClass,
  className,
  showButtons,
  children,
}: {
  label: string
  route: string
  branch: string
  branchClass: string
  className?: string
  showButtons?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className={`absolute ${className ?? ""}`}>
      <div className="absolute bottom-full left-0 mb-1 flex flex-col items-start whitespace-nowrap">
        <span
          className={`mb-0.5 inline-flex max-w-[14rem] items-center rounded-md px-1.5 py-0 font-mono text-[10px] ${branchClass}`}
        >
          <span className="truncate">{branch}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-green-500 ring-1 ring-background" />
          <span className="text-[11px] font-medium text-foreground/70">
            {label}
          </span>
          <span className="rounded-md bg-muted px-1.5 py-0 font-mono text-[10px] text-foreground/50">
            {route}
          </span>
        </div>
      </div>

      {showButtons && (
        <div className="absolute right-0 bottom-full mb-1 flex h-5 items-center gap-0.5">
          <ArtboardButton>
            <SlidersIcon />
          </ArtboardButton>
          <ArtboardButton>
            <CommentIcon />
          </ArtboardButton>
          <ArtboardButton>
            <ShareIcon />
          </ArtboardButton>
        </div>
      )}

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

function FakePricing({ dark }: { dark?: boolean }) {
  const surface = dark ? "bg-zinc-950 text-white" : "bg-white text-foreground"
  const card = dark
    ? "border-white/10 bg-white/5"
    : "border-border bg-background"
  const muted = dark ? "bg-white/30" : "bg-muted-foreground/40"
  const heading = dark ? "bg-white/90" : "bg-foreground/85"
  return (
    <div className={`flex h-full flex-col gap-1.5 rounded ${surface} p-1`}>
      {/* Title */}
      <div className={`h-2 w-2/3 rounded ${heading}`} />
      <div className={`h-1.5 w-3/4 rounded ${muted}`} />
      {/* Three plan cards */}
      <div className="mt-1 grid flex-1 grid-cols-3 gap-1.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`flex flex-col gap-1 rounded-md border ${card} p-1.5`}
          >
            <div className={`h-1 w-1/2 rounded ${muted}`} />
            <div className={`h-2 w-2/3 rounded ${heading}`} />
            <div className={`h-0.5 w-full rounded ${muted}`} />
            <div className={`h-0.5 w-3/4 rounded ${muted}`} />
            <div className={`h-0.5 w-2/3 rounded ${muted}`} />
            <div
              className={`mt-auto h-2.5 rounded-md ${
                i === 1 ? "bg-[#106BE3]" : dark ? "bg-white/15" : "bg-muted"
              }`}
            />
          </div>
        ))}
      </div>
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

function CommentThread({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`flex items-start gap-1 ${className ?? ""}`}>
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full rounded-bl-none border-2 border-background bg-amber-500 text-[10px] font-semibold text-white shadow-md">
        2
      </div>
      <div className="hidden max-w-[12rem] rounded-md rounded-tl-none border border-border bg-card px-2 py-1.5 text-[10px] leading-snug text-foreground shadow-md sm:block">
        {children}
      </div>
    </div>
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

function CommentIcon() {
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
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}

function ShareIcon() {
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
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  )
}
