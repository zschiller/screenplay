type Problem = {
  label: string
  body: string
}

const problems: Problem[] = [
  {
    label: "One at a time",
    body: "You ask the agent for three takes on a layout. It gives you one. You pick it, or you ask again, or you try to remember what the first one looked like. You can't see them together because they're in different branches.",
  },
  {
    label: "Switching is slow",
    body: "git checkout, npm install, wait for rebuild, refresh. Every time you want to compare alternatives, you lose context. The previous branch is gone. You're comparing memory to reality.",
  },
  {
    label: "Screenshots lie",
    body: "You can screenshot branches, but screenshots don't click. Screen recordings don't show how state changes. PDFs don't let you scroll. Comparing branches through static artifacts doesn't work.",
  },
]

export function MinimalProblems() {
  return (
    <section className="brutal-border-b">
      <div className="mx-auto w-full max-w-5xl px-6 py-20 sm:py-24">
        <span className="brutal-border-2 inline-block bg-white px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.18em]">
          What changed
        </span>
        <h2 className="mt-6 max-w-3xl text-balance text-3xl font-extrabold uppercase leading-[1] tracking-tight sm:text-5xl">
          The problem with one branch at a time.
        </h2>

        <ul className="mt-14 grid gap-6 sm:grid-cols-3">
          {problems.map((p, i) => (
            <li
              key={p.label}
              className="brutal-border brutal-shadow flex flex-col bg-white p-6"
            >
              <span className="font-mono text-3xl font-extrabold text-[var(--brutal-blue)]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="mt-4 font-mono text-xs font-bold uppercase tracking-[0.14em]">
                {p.label}
              </span>
              <p className="mt-3 text-sm font-medium leading-relaxed text-[var(--brutal-ink)]">
                {p.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
