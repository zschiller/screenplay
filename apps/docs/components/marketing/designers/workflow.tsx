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
    body: "Each artboard is its own branch in its own sandbox, so multiple directions can be compared on the canvas instead of toggled between.",
  },
  {
    num: "03",
    title: "Bring the team in",
    body: "Share the link. Reviewers see the same artboards, the same agent transcript, and your cursor. Comments anchor to elements, and state syncs across the room.",
  },
  {
    num: "04",
    title: "Refine with knobs and commit",
    body: "Ask the agent to expose the values you want adjustable, then refine them live with the room watching. When the result is right, the agent writes the chosen values back into the code.",
  },
]

export function DesignerWorkflow() {
  return (
    <section className="border-b border-border/60 bg-muted/30">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <span className="font-mono text-xs uppercase tracking-wider text-[#106BE3]">
            The end-to-end loop
          </span>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Prompt, branch, and review without leaving the canvas.
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
