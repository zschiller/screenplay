type Step = {
  num: string
  title: string
  body: string
}

const steps: Step[] = [
  {
    num: "01",
    title: "Prototype in code with the agent",
    body: "Work with Screenplay's coding agent inside the sandbox to build your routes and components. Same as Cursor or Claude in your IDE — except the canvas is right there.",
  },
  {
    num: "02",
    title: "Drop the route on a canvas",
    body: "Each artboard boots its own sandbox VM. The actual page renders — real data, real animations — not a flattened export.",
  },
  {
    num: "03",
    title: "Collaborate on the live UI",
    body: "Leave notes, drop comments anchored to elements, scrub through states together, and ask the agent to expose knobs for any value you want to tune live.",
  },
  {
    num: "04",
    title: "Share a link with anyone",
    body: "PMs, engineers, and other designers join the same room. Cursors, comments, knob values, and state stay in lock-step across every viewer.",
  },
]

export function DesignerWorkflow() {
  return (
    <section className="border-b border-border/60 bg-muted/30">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <span className="font-mono text-xs uppercase tracking-wider text-[#106BE3]">
            The designer workflow
          </span>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            From a route on your machine to a room your team can review.
          </h2>
        </div>

        <ol className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <li
              key={s.num}
              className="relative flex flex-col gap-3 rounded-xl border border-border bg-card p-6"
            >
              <span className="font-mono text-xs font-semibold tracking-widest text-[#106BE3]">
                {s.num}
              </span>
              <h3 className="text-lg font-semibold tracking-tight">
                {s.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
