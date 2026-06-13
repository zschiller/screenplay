type Problem = {
  label: string
  body: string
}

const problems: Problem[] = [
  {
    label: "One at a time",
    body: "AI agents explore one branch at a time. You can't ask for three variations and see them side by side. Screenplay runs each branch in its own sandbox, all visible on the canvas. Compare alternatives, not commit messages.",
  },
  {
    label: "Switching is slow",
    body: "git checkout, wait for rebuild, refresh the page. Toggling between branches breaks your flow and hides the alternatives. In Screenplay, every branch is one click away, already running, already in view.",
  },
  {
    label: "Context collapse",
    body: "Screenshots don't capture interaction. Screen recordings don't show state. Comparing branches means comparing static artifacts. Screenplay keeps every branch live — same state, same cursors, same canvas.",
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
          AI agents go deep. Screenplay helps you go broad.
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
