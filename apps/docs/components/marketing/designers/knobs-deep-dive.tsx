import { CodeBlock, tok } from "../code-block"

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
              Expose every design tweak as a live control.
            </h2>
            <p className="mt-4 max-w-xl text-muted-foreground">
              Component variants in Figma are static. Knobs aren&apos;t. Declare
              a slider, color picker, switch, or select right inside your
              component, and Screenplay renders it next to the artboard. Drag
              the value, see the actual UI respond — gradients, layout shifts,
              animations, all of it.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
              <Bullet>
                <span className="text-foreground">
                  Live, not approximated.
                </span>{" "}
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
                <span className="text-foreground">Dev-only, ship-safe.</span>{" "}
                Calls compile out of production builds. Leave them in code,
                they&apos;re no-ops where they shouldn&apos;t fire.
              </Bullet>
              <Bullet>
                <span className="text-foreground">
                  Anywhere in the tree.
                </span>{" "}
                Knobs are just hooks — drop one in a button, a hero, a
                navbar. Each one shows up grouped under its artboard.
              </Bullet>
            </ul>

            <div className="mt-8">
              <KnobsCode />
            </div>
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

function KnobsCode() {
  return (
    <CodeBlock filename="hero.tsx">
      <span className={tok.keyword}>import</span> {"{ "}
      <span className={tok.fn}>useKnob</span>
      {" } "}
      <span className={tok.keyword}>from</span>{" "}
      <span className={tok.string}>{`"@screenplay.space/knobs"`}</span>
      {"\n\n"}
      <span className={tok.keyword}>export function</span>{" "}
      <span className={tok.fn}>Hero</span>
      <span className={tok.punct}>{"() {"}</span>
      {"\n  "}
      <span className={tok.keyword}>const</span> headline ={" "}
      <span className={tok.fn}>useKnob</span>
      <span className={tok.punct}>{"({ "}</span>
      <span className={tok.prop}>id</span>:{" "}
      <span className={tok.string}>{`"headline"`}</span>,{" "}
      <span className={tok.prop}>type</span>:{" "}
      <span className={tok.string}>{`"text"`}</span>,{" "}
      <span className={tok.prop}>default</span>:{" "}
      <span className={tok.string}>{`"Ship faster."`}</span>{" "}
      <span className={tok.punct}>{"})"}</span>
      {"\n  "}
      <span className={tok.keyword}>const</span> accent ={" "}
      <span className={tok.fn}>useKnob</span>
      <span className={tok.punct}>{"({ "}</span>
      <span className={tok.prop}>id</span>:{" "}
      <span className={tok.string}>{`"accent"`}</span>,{" "}
      <span className={tok.prop}>type</span>:{" "}
      <span className={tok.string}>{`"color"`}</span>,{" "}
      <span className={tok.prop}>default</span>:{" "}
      <span className={tok.string}>{`"#106BE3"`}</span>{" "}
      <span className={tok.punct}>{"})"}</span>
      {"\n  "}
      <span className={tok.keyword}>const</span> radius ={" "}
      <span className={tok.fn}>useKnob</span>
      <span className={tok.punct}>{"({ "}</span>
      <span className={tok.prop}>id</span>:{" "}
      <span className={tok.string}>{`"radius"`}</span>,{" "}
      <span className={tok.prop}>type</span>:{" "}
      <span className={tok.string}>{`"slider"`}</span>,{" "}
      <span className={tok.prop}>min</span>:{" "}
      <span className={tok.number}>0</span>,{" "}
      <span className={tok.prop}>max</span>:{" "}
      <span className={tok.number}>32</span>{" "}
      <span className={tok.punct}>{"})"}</span>
      {"\n  "}
      <span className={tok.keyword}>const</span> tone ={" "}
      <span className={tok.fn}>useKnob</span>
      <span className={tok.punct}>{"({ "}</span>
      <span className={tok.prop}>id</span>:{" "}
      <span className={tok.string}>{`"tone"`}</span>,{" "}
      <span className={tok.prop}>type</span>:{" "}
      <span className={tok.string}>{`"select"`}</span>,{" "}
      <span className={tok.prop}>options</span>:{" "}
      <span className={tok.punct}>{`["light", "dark"]`}</span>{" "}
      <span className={tok.punct}>{"})"}</span>
      {"\n\n  "}
      <span className={tok.comment}>{`// real component, real state, knob-driven`}</span>
      {"\n  "}
      <span className={tok.keyword}>return</span>{" "}
      <span className={tok.punct}>{"<HeroBlock {...{ headline, accent, radius, tone }} />"}</span>
      {"\n"}
      <span className={tok.punct}>{"}"}</span>
    </CodeBlock>
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

      {/* Live preview that responds to the knob animations */}
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/80 bg-muted/30 p-5">
        <div className="knob-card-radius w-full max-w-xs border border-border bg-background p-4 shadow-sm">
          <div className="flex flex-col gap-2">
            <div className="knob-headline-fade h-2.5 w-2/3 rounded bg-foreground/85" />
            <div className="h-1.5 w-3/4 rounded bg-muted-foreground/40" />
            <div className="h-1.5 w-2/3 rounded bg-muted-foreground/40" />
            <div className="knob-accent-bg knob-card-radius mt-2 h-5 w-1/3 rounded-md" />
          </div>
        </div>
      </div>

      {/* Knob panel — multiple knob types stacked */}
      <div className="space-y-2.5 rounded-lg border border-border bg-background/70 p-3">
        {/* Text knob */}
        <KnobRow label="Headline" badge="text">
          <div className="flex h-6 items-center rounded-md border border-border bg-card px-2">
            <span className="knob-headline-text font-mono text-[10px] text-foreground/80" />
            <span className="ml-0.5 h-3 w-px animate-pulse bg-foreground/60" />
          </div>
        </KnobRow>

        {/* Color knob */}
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

        {/* Slider knob */}
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
              <span className="knob-value-fade">●</span>
            </span>
          </div>
        </KnobRow>

        {/* Switch knob */}
        <KnobRow label="Show CTA" badge="switch">
          <span className="knob-switch relative inline-flex h-3.5 w-6 items-center rounded-full bg-[#106BE3]/30">
            <span className="knob-switch-thumb absolute left-0.5 size-2.5 rounded-full bg-background shadow" />
          </span>
        </KnobRow>

        {/* Select knob */}
        <KnobRow label="Tone" badge="select">
          <div className="flex h-6 items-center justify-between rounded-md border border-border bg-card px-2">
            <span className="knob-select-value font-mono text-[10px] text-foreground/80" />
            <ChevronIcon />
          </div>
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

function ChevronIcon() {
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
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
