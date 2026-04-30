export function StateMockup() {
  return (
    <div className="relative grid h-full gap-3 rounded-xl border border-border bg-card p-5 shadow-sm sm:grid-cols-2">
      <FakeBrowser label="alex.dev" />
      <FakeBrowser label="sam.dev" />

      {/* Sync indicator */}
      <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-border bg-background px-2 py-1 shadow-sm sm:flex">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#106BE3] opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-[#106BE3]" />
        </span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          synced
        </span>
      </div>
    </div>
  )
}

function FakeBrowser({ label }: { label: string }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border/70 bg-muted/40 px-3 py-1.5">
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          count
        </span>
        <CounterRoller />
        <span className="font-mono text-[10px] text-muted-foreground/80">
          useSharedState
        </span>
      </div>
    </div>
  )
}

function CounterRoller() {
  return (
    <div className="state-bump flex h-9 w-9 items-center justify-center overflow-hidden rounded-md border border-border bg-card text-2xl font-semibold tabular-nums text-[#106BE3]">
      <div className="state-tick flex flex-col">
        <span className="flex h-9 items-center justify-center">0</span>
        <span className="flex h-9 items-center justify-center">1</span>
        <span className="flex h-9 items-center justify-center">2</span>
        <span className="flex h-9 items-center justify-center">3</span>
      </div>
    </div>
  )
}
