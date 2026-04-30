export function KnobsMockup() {
  return (
    <div className="relative flex h-full flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      {/* Mini-artboard label — same pattern the canvas uses (branch badge,
          HMR dot + screen name + route pill). */}
      <div className="flex flex-col items-start gap-1">
        <span className="inline-flex items-center rounded-md bg-blue-100 px-1.5 py-0 font-mono text-[10px] text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          feat/card
        </span>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-green-500 ring-1 ring-card" />
          <span className="text-[11px] font-medium text-foreground/70">
            Card
          </span>
          <span className="rounded-md bg-muted px-1.5 py-0 font-mono text-[10px] text-foreground/50">
            /card
          </span>
        </div>
      </div>

      {/* Animated card preview that responds to the knob */}
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/80 bg-muted/30 py-6">
        <div className="card-pad rounded-lg border border-border bg-background p-4 shadow-sm">
          <div className="flex w-44 flex-col gap-2">
            <div className="h-2 w-1/2 rounded bg-foreground/80" />
            <div className="h-1.5 w-3/4 rounded bg-muted-foreground/40" />
            <div className="h-1.5 w-2/3 rounded bg-muted-foreground/40" />
          </div>
        </div>
      </div>

      {/* Knob popover */}
      <div className="rounded-lg border border-border bg-background/60 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-foreground">Padding</span>
          <span className="font-mono text-xs text-muted-foreground">
            <span className="knob-value-fade">●</span> px
          </span>
        </div>
        <div className="relative h-1.5 rounded-full bg-muted">
          <div
            className="knob-fill absolute left-0 top-0 h-1.5 rounded-full bg-[#106BE3]"
            style={{ width: "14%" }}
          />
          <div
            className="knob-thumb absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#106BE3] bg-background shadow"
            style={{ left: "14%" }}
          />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted-foreground/70">
          <span>0</span>
          <span>64</span>
        </div>
      </div>
    </div>
  )
}
