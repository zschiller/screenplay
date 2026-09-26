const items = [
  "Claude Code",
  "Codex",
  "opencode",
  "Vercel AI Gateway",
  "git worktrees",
  "Vercel Sandbox",
  "Any OpenAI-compatible model",
]

export function AgentsStrip() {
  return (
    <section className="border-y border-border/60 bg-muted/30">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-5 px-5 py-10 sm:px-8 md:flex-row md:gap-10">
        <p className="shrink-0 text-sm text-muted-foreground">
          Bring the agents you already use
        </p>
        <div className="marquee relative w-full overflow-hidden">
          <div className="marquee-track flex w-max gap-10">
            {[...items, ...items].map((item, i) => (
              <span
                key={i}
                aria-hidden={i >= items.length}
                className="text-lg font-semibold tracking-tight whitespace-nowrap text-foreground/70"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
