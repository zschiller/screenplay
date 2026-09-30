import { cn } from "@workspace/ui/lib/utils"

import { FrameExcerpt } from "../excerpts/canvas"
import { measure, monoLabel } from "./editorial"
import { SectionHeading } from "./section-heading"

const dance = [
  ["$", "git worktree add ../bold pricing-bold"],
  ["$", "cd ../bold && pnpm install"],
  ["$", "PORT=3001 pnpm dev"],
  ["", "▲ Ready on localhost:3001"],
  ["$", "cd ../minimal && pnpm install"],
  ["$", "PORT=3002 pnpm dev"],
  ["", "▲ Ready on localhost:3002"],
] as const

export function Problem() {
  return (
    <section className={cn(measure, "pt-[clamp(72px,10vw,140px)]")}>
      <SectionHeading
        slug="The problem"
        title="Three versions means three setups and three tabs."
        body="Every worktree needs its own install, port and dev server, and each result lands in another browser tab."
      />

      <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-2.5">
          {/* A terminal is black in both themes. */}
          <div className="flex-1 border border-border bg-black p-5.5 font-mono text-xs leading-[1.9] text-neutral-200 sm:text-[13.5px] lg:min-h-64">
            <div>
              {dance.map(([p, cmd], i) => (
                <div key={i} className="flex gap-2.5">
                  {p ? <span className="text-neutral-500">{p}</span> : null}
                  <span className={p === "$" ? "" : "text-neutral-500"}>
                    {cmd}
                  </span>
                </div>
              ))}
              <div className="flex gap-2.5">
                <span className="text-neutral-500">$</span>
                <span className="caret-blink h-4 w-2 translate-y-1 bg-neutral-400" />
              </div>
            </div>
          </div>
          <p className={cn(monoLabel, "text-muted-foreground")}>
            Without Screenplay
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-2.5">
          <FrameExcerpt />
          <p className={cn(monoLabel, "text-muted-foreground")}>
            With Screenplay
          </p>
        </div>
      </div>
    </section>
  )
}
