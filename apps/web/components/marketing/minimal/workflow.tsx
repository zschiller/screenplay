type Step = {
  num: string
  title: string
  body: string
}

const steps: Step[] = [
  {
    num: "01",
    title: "Each artboard is a branch",
    body: "You get a canvas. Each artboard on it is a git branch running in its own sandbox. Duplicate an artboard and you've created a branch. The agent can work on all of them.",
  },
  {
    num: "02",
    title: "They're all running",
    body: "Every branch is already built and running. Click between them. Pan around the canvas. They're not in tabs, they're just there, next to each other.",
  },
  {
    num: "03",
    title: "Ask for variations",
    body: "Tell the agent to try three approaches. Each one goes in its own artboard. You see them together. Pick one, or keep working on all three.",
  },
  {
    num: "04",
    title: "Share a link",
    body: "Send the link to your team. They see the same canvas, the same branches, your cursor. They can click around and comment. No screenshots needed.",
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
          How it works.
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
