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
    <section id="how" className="scroll-mt-24">
      <div className="mx-auto w-full max-w-3xl px-6 py-20 sm:py-24">
        <span className="neu-inset-sm inline-block rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          How it works
        </span>
        <h2 className="mt-6 text-balance text-2xl font-medium tracking-tight sm:text-3xl">
          How it works.
        </h2>

        <ol className="mt-12 grid gap-6 sm:grid-cols-2">
          {steps.map((s) => (
            <li
              key={s.num}
              className="neu-raised flex flex-col rounded-3xl bg-background p-7"
            >
              <div className="neu-inset flex h-11 w-11 items-center justify-center rounded-full font-mono text-xs font-medium text-primary">
                {s.num}
              </div>
              <h3 className="mt-5 text-sm font-medium text-foreground">
                {s.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
