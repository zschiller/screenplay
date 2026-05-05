"use client"

import { useState } from "react"

const ACCENTS = [
  { color: "#106BE3", bg: "bg-[#106BE3]" },
  { color: "#10B981", bg: "bg-emerald-500" },
  { color: "#F59E0B", bg: "bg-amber-500" },
  { color: "#F43F5E", bg: "bg-rose-500" },
  { color: "#8B5CF6", bg: "bg-violet-500" },
]

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
              Adjust values without re-prompting the agent.
            </h2>
            <p className="mt-4 max-w-xl text-muted-foreground">
              Small adjustments — spacing, copy, a color — don&apos;t need a
              full round-trip through the agent. Ask the agent once to
              expose a value as a knob, and you or a reviewer can change it
              live. The real component responds, including gradients,
              layout, and animations tied to that value.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
              <Bullet>
                <span className="text-foreground">Live, not approximated.</span>{" "}
                Every knob change re-renders the real component using real
                state and real data.
              </Bullet>
              <Bullet>
                <span className="text-foreground">
                  Multiplayer by default.
                </span>{" "}
                Values sync to every viewer in the room, so a reviewer&apos;s
                adjustment appears on your screen immediately.
              </Bullet>
              <Bullet>
                <span className="text-foreground">
                  Added by the agent on demand.
                </span>{" "}
                Ask for a knob in plain language and the canvas agent wires
                it in. Subsequent adjustments happen in the panel.
              </Bullet>
              <Bullet>
                <span className="text-foreground">
                  Commit a value when you&apos;re done.
                </span>{" "}
                Once you&apos;ve settled on a value, the agent can write it
                back into the code as the new default.
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
  const [accent, setAccent] = useState(ACCENTS[0]!)

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

      {/* Live preview */}
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/80 bg-muted/30 p-5">
        <div className="knob-card-radius w-full max-w-xs border border-border bg-background p-4 shadow-sm">
          <div className="flex flex-col gap-2">
            <div className="knob-headline-bar h-2.5 rounded bg-foreground/85" />
            <div className="h-1.5 w-3/4 rounded bg-muted-foreground/40" />
            <div className="h-1.5 w-2/3 rounded bg-muted-foreground/40" />
            <div className="mt-1">
              <div
                className="knob-card-radius h-5 w-1/2 transition-colors duration-300"
                style={{ backgroundColor: accent.color }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Knob panel */}
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
            {ACCENTS.map((a) => (
              <button
                key={a.color}
                onClick={() => setAccent(a)}
                className={`size-4 rounded border transition-transform ${a.bg} ${
                  a.color === accent.color
                    ? "scale-125 border-foreground/40 shadow-sm"
                    : "border-border hover:scale-110"
                }`}
              />
            ))}
            <span className="ml-1 font-mono text-[10px] text-muted-foreground transition-colors duration-300">
              {accent.color}
            </span>
          </div>
        </KnobRow>

        {/* Slider knob → card + CTA border-radius */}
        <KnobRow label="Radius" badge="slider">
          <div className="flex items-center gap-2">
            <div className="relative h-1.5 w-32 rounded-full bg-muted">
              <div
                className="knob-fill absolute left-0 top-0 h-1.5 rounded-full"
                style={{ backgroundColor: accent.color }}
              />
              <div
                className="knob-thumb absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-background shadow"
                style={{ borderColor: accent.color }}
              />
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              <span className="knob-radius-value" />
              px
            </span>
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

