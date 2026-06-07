type Step = {
  num: string
  title: string
  body: string
}

const steps: Step[] = [
  {
    num: "01",
    title: "Build with the agent",
    body: "Each artboard runs a coding agent inside its own sandbox. The loop is the same as Cursor or Claude Code, with the canvas one click away.",
  },
  {
    num: "02",
    title: "Branch side by side",
    body: "Each artboard is its own branch in its own sandbox. Compare directions on the canvas instead of toggling between tabs.",
  },
  {
    num: "03",
    title: "Bring the team in",
    body: "Share the link. Reviewers see the same artboards, the same agent transcript, and your cursor. Comments anchor to elements.",
  },
  {
    num: "04",
    title: "Refine and commit",
    body: "Expose values as knobs, refine them live, and the agent writes the chosen values back into the code as new defaults.",
  },
]

export function MinimalWorkflow() {
  return (
    <section id="how" className="border-b border-border/60 scroll-mt-16">
      <div className="mx-auto w-full max-w-3xl px-6 py-24 sm:py-28">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          How it works
        </span>
        <h2 className="mt-4 text-balance text-2xl font-medium tracking-tight sm:text-3xl">
          Prompt, branch, and review without leaving the canvas.
        </h2>

        <ol className="mt-14 divide-y divide-border/60">
          {steps.map((s) => (
            <li
              key={s.num}
              className="grid gap-3 py-7 sm:grid-cols-[10rem_1fr] sm:gap-10"
            >
              <div className="flex items-baseline gap-3 sm:pt-1">
                <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground">
                  {s.num}
                </span>
                <span className="text-sm font-medium text-foreground sm:hidden">
                  {s.title}
                </span>
              </div>
              <div>
                <h3 className="hidden text-sm font-medium text-foreground sm:block">
                  {s.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground sm:mt-1">
                  {s.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
