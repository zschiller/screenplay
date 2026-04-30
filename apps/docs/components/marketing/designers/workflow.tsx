type Step = {
  num: string
  title: string
  body: string
}

const steps: Step[] = [
  {
    num: "01",
    title: "Vibe code with the agent",
    body: "Build the prototype the way you already do — Screenplay runs a coding agent inside the sandbox attached to each artboard. Same loop as Cursor or Claude Code, with the canvas one click away.",
  },
  {
    num: "02",
    title: "Branch out, side by side",
    body: "Try three takes on the screen. Each artboard is its own branch in its own sandbox. Compare directions on a canvas instead of in your head.",
  },
  {
    num: "03",
    title: "Bring the team in",
    body: "Drop the link in Slack. Reviewers see the same artboards, the same agent transcript, and your cursor. Comments anchor to elements. State syncs across the room.",
  },
  {
    num: "04",
    title: "Tighten with knobs, then ship",
    body: "Ask the agent to expose the values you want adjustable. Dial them in live with the room watching. When the look is right, commit the values back into the code.",
  },
]

export function DesignerWorkflow() {
  return (
    <section className="border-b border-border/60 bg-muted/30">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <span className="font-mono text-xs uppercase tracking-wider text-[#106BE3]">
            The vibe-coding loop, restored
          </span>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Prompt, branch, review — without leaving the canvas.
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
