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
    <section id="how" className="brutal-border-b scroll-mt-16">
      <div className="mx-auto w-full max-w-5xl px-6 py-20 sm:py-24">
        <span className="brutal-border-2 inline-block bg-[var(--brutal-yellow)] px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.18em]">
          How it works
        </span>
        <h2 className="mt-6 text-balance text-3xl font-extrabold uppercase leading-[1] tracking-tight sm:text-5xl">
          Four moves. One canvas.
        </h2>

        <ol className="mt-14 grid gap-6 sm:grid-cols-2">
          {steps.map((s, i) => (
            <li
              key={s.num}
              className="brutal-border brutal-shadow flex gap-5 bg-white p-6"
            >
              <span
                className="brutal-border-2 grid h-14 w-14 shrink-0 place-items-center font-mono text-xl font-extrabold text-white"
                style={{
                  backgroundColor:
                    i % 2 === 0 ? "var(--brutal-blue)" : "var(--brutal-ink)",
                }}
              >
                {s.num}
              </span>
              <div>
                <h3 className="font-mono text-sm font-bold uppercase tracking-[0.1em] text-[var(--brutal-ink)]">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm font-medium leading-relaxed text-[var(--brutal-ink)]">
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
