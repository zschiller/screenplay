type Step = {
  num: string
  title: string
  body: string
}

const steps: Step[] = [
  {
    num: "01",
    title: "Spin up branches",
    body: "Each artboard is its own git branch in its own sandbox. Duplicate an artboard to explore an alternative. The AI agent builds each direction in parallel.",
  },
  {
    num: "02",
    title: "See them side by side",
    body: "Branches don't live in tabs or terminal windows. They sit next to each other on the canvas, already running, already interactive. Pan to compare, click to focus.",
  },
  {
    num: "03",
    title: "Go broad with AI",
    body: "Ask the agent for three takes on a layout. Try a different color system. Explore edge cases. Each direction gets its own artboard. The canvas holds them all.",
  },
  {
    num: "04",
    title: "Share the whole space",
    body: "Send one link. Your team sees every branch, every state, your live cursor. They comment on elements, not screenshots. Review happens on the canvas.",
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
          Multiple branches, one canvas, zero context switching.
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
