import {
  BoldPricing,
  BranchBadge,
  MinimalPricing,
  PlayfulPricing,
} from "./variants"
import { Mascot } from "./mascot"
import { ScaleToFit } from "./scale-to-fit"
import { SectionHeading } from "./section-heading"

const dance = [
  ["$", "git stash"],
  ["$", "git checkout pricing-minimal"],
  ["$", "pnpm install"],
  ["$", "pnpm dev"],
  ["", "▲ Ready in 14.2s"],
  ["#", "wait… what did the bold one look like?"],
  ["$", "git checkout pricing-bold"],
  ["$", "pnpm dev"],
] as const

const takes = [
  ["pricing-bold", "red", BoldPricing],
  ["pricing-minimal", "sky", MinimalPricing],
  ["pricing-playful", "amber", PlayfulPricing],
] as const

export function Problem() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-24 sm:px-8 sm:py-32">
      <SectionHeading
        slug="INT. Your editor — late night"
        title="Your agent wrote three versions. You can only see one."
        body="Agents are great at trying things. But every idea lands in a different branch, and comparing them means stashing, checking out, reinstalling and rebuilding — then comparing memory to reality. Screenshots don't click."
      />

      <div className="mt-14 grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="relative flex flex-col overflow-hidden rounded-2xl border border-border bg-[#0D0F14] p-5 text-[13px] text-zinc-300 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
              Without Screenplay
            </span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[11px] text-zinc-500">
              zsh
            </span>
          </div>
          <div className="mt-5 flex flex-col gap-1.5 font-mono">
            {dance.map(([p, cmd], i) => (
              <div key={i} className="flex gap-3">
                <span
                  className={p === "#" ? "text-zinc-600" : "text-emerald-400"}
                >
                  {p}
                </span>
                <span
                  className={
                    p === "#"
                      ? "text-zinc-500 italic"
                      : p === ""
                        ? "text-zinc-500"
                        : ""
                  }
                >
                  {cmd}
                </span>
              </div>
            ))}
            <div className="flex gap-3">
              <span className="text-emerald-400">$</span>
              <span className="caret-blink h-4 w-2 translate-y-0.5 bg-zinc-400" />
            </div>
          </div>
          <div className="mt-auto flex items-end justify-between pt-8">
            <span className="text-xs text-zinc-500">
              One branch at a time. Every time.
            </span>
            <Mascot
              size={44}
              tone="ink"
              follow={false}
              gaze={{ x: -0.4, y: 0.8 }}
              mood="sad"
            />
          </div>
        </div>

        <div className="relative flex flex-col overflow-hidden rounded-2xl border border-border bg-muted/40 [background-image:radial-gradient(var(--dot)_1px,transparent_1px)] [background-size:16px_16px] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium tracking-wide text-[#106BE3] uppercase dark:text-[#6AA8FF]">
              With Screenplay
            </span>
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              3 running
            </span>
          </div>
          <div className="mt-5 grid flex-1 grid-cols-3 gap-3">
            {takes.map(([branch, color, Take]) => (
              <div key={branch} className="flex min-w-0 flex-col gap-1.5">
                <BranchBadge
                  name={branch}
                  color={color}
                  className="self-start truncate max-sm:max-w-full max-sm:text-[8px]"
                />
                <ScaleToFit
                  width={196}
                  height={262}
                  className="overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-300 hover:-translate-y-1 hover:-rotate-[0.5deg]"
                >
                  <Take />
                </ScaleToFit>
              </div>
            ))}
          </div>
          <div className="mt-5 text-xs text-muted-foreground">
            Every branch built, running and clickable — side by side, all the
            time.
          </div>
        </div>
      </div>
    </section>
  )
}
