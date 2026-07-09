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
    <section>
      <div className="mx-auto w-full max-w-3xl px-6 py-20 sm:py-24">
        <span className="neu-inset-sm inline-block rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          What changed
        </span>
        <h2 className="mt-6 text-balance text-2xl font-medium tracking-tight sm:text-3xl">
          The problem with one branch at a time.
        </h2>

        <ul className="mt-12 grid gap-6">
          {problems.map((p) => (
            <li
              key={p.label}
              className="neu-raised rounded-3xl bg-background p-7 sm:p-8"
            >
              <span className="neu-inset-sm inline-block rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {p.label}
              </span>
              <p className="mt-4 text-sm leading-relaxed text-foreground/90">
                {p.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
