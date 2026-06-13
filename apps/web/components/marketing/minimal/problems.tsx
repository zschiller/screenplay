type Problem = {
  label: string
  body: string
}

const problems: Problem[] = [
  {
    label: "One at a time",
    body: "You ask the agent for three takes on a layout. It gives you one. You pick it, or you ask again, or you try to remember what the first one looked like. You can't see them together because they're in different branches.",
  },
  {
    label: "Switching is slow",
    body: "git checkout, npm install, wait for rebuild, refresh. Every time you want to compare alternatives, you lose context. The previous branch is gone. You're comparing memory to reality.",
  },
  {
    label: "Screenshots lie",
    body: "You can screenshot branches, but screenshots don't click. Screen recordings don't show how state changes. PDFs don't let you scroll. Comparing branches through static artifacts doesn't work.",
  },
]

export function MinimalProblems() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto w-full max-w-3xl px-6 py-24 sm:py-28">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          What changed
        </span>
        <h2 className="mt-4 text-balance text-2xl font-medium tracking-tight sm:text-3xl">
          The problem with one branch at a time.
        </h2>

        <ul className="mt-14 divide-y divide-border/60">
          {problems.map((p) => (
            <li
              key={p.label}
              className="grid gap-3 py-7 sm:grid-cols-[10rem_1fr] sm:gap-10"
            >
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:pt-1">
                {p.label}
              </span>
              <p className="text-sm leading-relaxed text-foreground/90">
                {p.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
