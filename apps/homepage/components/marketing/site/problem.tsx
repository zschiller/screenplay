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
        title="Agents write several versions. You see them one tab at a time."
        body="Worktrees let every branch run at once, but each one needs its own install, port and dev server, and the results end up spread across terminals and browser tabs. Comparing them means flipping between tabs and remembering what the last one looked like."
      />

      <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* A terminal is black in both themes. */}
        <div className="flex min-h-80 flex-col justify-between border border-border bg-black p-5.5 font-mono text-xs leading-[1.9] text-neutral-200 sm:text-[13.5px]">
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
          <p className={cn(monoLabel, "mt-8 text-neutral-500")}>
            Without Screenplay · a port and a tab per branch
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-2.5">
          <FrameExcerpt />
          <p className={cn(monoLabel, "text-muted-foreground")}>
            With Screenplay · every branch side by side
          </p>
        </div>
      </div>
    </section>
  )
}
