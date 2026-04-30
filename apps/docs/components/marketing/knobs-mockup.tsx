export function KnobsMockup() {
  return (
    <div className="relative flex h-full flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Card preview
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
          card.tsx
        </span>
      </div>

      {/* Animated card preview that responds to the knob */}
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/80 bg-muted/30 py-6">
        <div className="rounded-lg border border-border bg-background p-[var(--card-pad,16px)] shadow-sm transition-[padding] duration-150">
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
            <span className="knob-value">●</span> px
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
