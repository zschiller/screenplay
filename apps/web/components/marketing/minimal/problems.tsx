type Problem = {
  label: string
  body: string
}

const problems: Problem[] = [
  {
    label: "Collaboration",
    body: "Localhost and agent chats aren't shared. Two designers working on the same prototype can't see each other's screens or read each other's transcripts. Screenplay puts the prototype in a shared room — same artboards, same sandbox, same agent.",
  },
  {
    label: "Going broad",
    body: "Agents work one direction at a time. Comparing alternatives means juggling branches that don't sit next to each other. In Screenplay, each artboard is its own branch in its own sandbox, side by side on the canvas.",
  },
  {
    label: "Communication",
    body: "Screen recordings aren't a substitute for design review. Screenplay lays every screen and every state on an infinite canvas. Comments anchor to elements, and changing state updates every viewer in the room.",
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
          Real code adds capability. It also breaks parts of the design loop.
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
