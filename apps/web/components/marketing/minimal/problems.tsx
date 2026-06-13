type Problem = {
  label: string
  body: string
}

const problems: Problem[] = [
  {
    label: "Native experience",
    body: "Browser tabs slow you down. The Screenplay desktop app gives you a dedicated workspace with native performance, offline support, and no distractions. Focus on building without fighting your browser.",
  },
  {
    label: "Local-first",
    body: "Your prototypes live on your machine. Work offline, keep your code local, and sync when you're ready. The desktop app manages your sandboxes and branches without relying on cloud infrastructure.",
  },
  {
    label: "Integrated workflow",
    body: "Jump between the canvas, the agent, and your code editor without switching apps. The desktop app integrates with your local development environment, making the loop from idea to prototype seamless.",
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
          A desktop app built for the way you actually work.
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
