import { cn } from "@workspace/ui/lib/utils"

import { measure, monoLabel } from "./editorial"

const items = [
  "Claude Code",
  "Codex",
  "opencode",
  "Vercel AI Gateway",
  "git worktrees",
]

export function AgentsStrip() {
  return (
    <section className="mt-18 border-y border-border">
      <div
        className={cn(
          measure,
          "flex flex-wrap items-center gap-x-9 gap-y-3 py-5.5"
        )}
      >
        <p className={cn(monoLabel, "text-muted-foreground")}>Works with</p>
        {items.map((item) => (
          <span
            key={item}
            className="font-heading text-[17px] leading-none tracking-[-0.03em]"
          >
            {item}
          </span>
        ))}
      </div>
    </section>
  )
}
