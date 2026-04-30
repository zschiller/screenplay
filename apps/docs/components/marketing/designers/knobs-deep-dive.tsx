export function KnobsDeepDive() {
  return (
    <section
      id="knobs"
      className="border-b border-border/60 bg-muted/30 scroll-mt-16"
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-[1.05fr_1fr] lg:items-start">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-[#106BE3]">
              Knobs
            </span>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Tune the design without leaving the canvas.
            </h2>
            <p className="mt-4 max-w-xl text-muted-foreground">
              Component variants in Figma are static. Knobs aren&apos;t. Ask
              the agent to expose any value — copy, color, spacing, a toggle,
              a select — and a live control shows up next to the artboard.
              Drag it and the actual component responds: gradients, layout
              shifts, animations, all of it.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
              <Bullet>
                <span className="text-foreground">Live, not approximated.</span>{" "}
                Every knob change re-renders the real component, with real
                state and real data.
              </Bullet>
              <Bullet>
                <span className="text-foreground">
                  Multiplayer by default.
                </span>{" "}
                Values sync to every viewer in the room — your PM&apos;s drag
                shows up on your screen, instantly.
              </Bullet>
              <Bullet>
                <span className="text-foreground">
                  Added by the agent, on demand.
                </span>{" "}
                &ldquo;Make the headline editable&rdquo; or &ldquo;let me try
                different accent colors&rdquo; — the canvas&apos;s coding
                agent wires knobs into your code for you.
              </Bullet>
              <Bullet>
                <span className="text-foreground">
                  Anywhere in the UI.
                </span>{" "}
                A button, a hero, a nav. Each knob shows up grouped under the
                artboard it belongs to, so reviewers can find the dial they
                want.
              </Bullet>
            </ul>
          </div>

          <div>
            <KnobsBoard />
          </div>
        </div>
      </div>
    </section>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#106BE3]"
      />
      <span className="leading-relaxed">{children}</span>
    </li>
  )
}

function KnobsBoard() {
  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
      {/* Mini-artboard label */}
      <div className="flex flex-col items-start gap-1">
        <span className="inline-flex items-center rounded-md bg-pink-100 px-1.5 py-0 font-mono text-[10px] text-pink-700 dark:bg-pink-950 dark:text-pink-300">
          design/hero-v2
        </span>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-green-500 ring-1 ring-card" />
          <span className="text-[11px] font-medium text-foreground/70">
            Hero
          </span>
          <span className="rounded-md bg-muted px-1.5 py-0 font-mono text-[10px] text-foreground/50">
            /hero
          </span>
        </div>
      </div>

      {/* Live preview — every knob below drives something here */}
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/80 bg-muted/30 p-5">
        <div className="knob-card-radius w-full max-w-xs border border-border bg-background p-4 shadow-sm">
          <div className="flex flex-col gap-2">
            {/* Headline — width tracks the cycling headline knob */}
            <div className="knob-headline-bar h-2.5 rounded bg-foreground/85" />
            <div className="h-1.5 w-3/4 rounded bg-muted-foreground/40" />
            <div className="h-1.5 w-2/3 rounded bg-muted-foreground/40" />
            {/* CTA — visibility tracks the switch, color tracks the accent
                knob, corner radius tracks the slider (same class as the card) */}
            <div className="knob-cta-visible mt-1">
              <div className="knob-accent-bg knob-card-radius h-5 w-1/2" />
            </div>
          </div>
        </div>
      </div>

      {/* Knob panel — every row drives part of the preview */}
      <div className="space-y-2.5 rounded-lg border border-border bg-background/70 p-3">
        {/* Text knob → preview headline bar width */}
        <KnobRow label="Headline" badge="text">
          <div className="flex h-6 items-center rounded-md border border-border bg-card px-2">
            <span className="knob-headline-text font-mono text-[10px] text-foreground/80" />
            <span className="ml-0.5 h-3 w-px animate-pulse bg-foreground/60" />
          </div>
        </KnobRow>

        {/* Color knob → preview CTA background */}
        <KnobRow label="Accent" badge="color">
          <div className="flex items-center gap-1.5">
            <span className="knob-swatch-1 size-4 rounded border border-border bg-[#106BE3]" />
            <span className="knob-swatch-2 size-4 rounded border border-border bg-emerald-500" />
            <span className="knob-swatch-3 size-4 rounded border border-border bg-amber-500" />
            <span className="knob-swatch-4 size-4 rounded border border-border bg-rose-500" />
            <span className="knob-swatch-5 size-4 rounded border border-border bg-violet-500" />
            <span className="ml-1 font-mono text-[10px] text-muted-foreground">
              <span className="knob-accent-hex">#106BE3</span>
            </span>
          </div>
        </KnobRow>

        {/* Slider knob → card + CTA border-radius */}
        <KnobRow label="Radius" badge="slider">
          <div className="flex items-center gap-2">
            <div className="relative h-1.5 w-32 rounded-full bg-muted">
              <div
                className="knob-fill absolute left-0 top-0 h-1.5 rounded-full bg-[#106BE3]"
                style={{ width: "14%" }}
              />
              <div
                className="knob-thumb absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#106BE3] bg-background shadow"
                style={{ left: "14%" }}
              />
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              <span className="knob-radius-value" />
              px
            </span>
          </div>
        </KnobRow>

        {/* Switch knob → preview CTA visibility */}
        <KnobRow label="Show CTA" badge="switch">
          <span className="knob-switch relative inline-flex h-3.5 w-6 items-center rounded-full bg-[#106BE3]/30">
            <span className="knob-switch-thumb absolute left-0.5 size-2.5 rounded-full bg-background shadow" />
          </span>
        </KnobRow>
      </div>
    </div>
  )
}

function KnobRow({
  label,
  badge,
  children,
}: {
  label: string
  badge: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex w-20 shrink-0 items-center justify-between gap-1.5">
        <span className="text-[11px] font-medium text-foreground">{label}</span>
        <span className="rounded bg-muted px-1 py-0 font-mono text-[8px] text-muted-foreground">
          {badge}
        </span>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

