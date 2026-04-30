type Step = {
  num: string
  title: string
  body: string
}

const steps: Step[] = [
  {
    num: "01",
    title: "Open a workspace",
    body: "Sign in with GitHub. Pick a repo — public or private — and Screenplay sets up an isolated room for your team.",
  },
  {
    num: "02",
    title: "Each artboard boots a sandbox",
    body: "Drop a route onto the canvas and a fresh VM provisions for it. The agent installs deps, wires env vars, and serves the page.",
  },
  {
    num: "03",
    title: "Collaborate live",
    body: "Cursors, viewport sync, comments anchored to the DOM, and Claude in the loop. Knobs and shared state sync across every viewer.",
  },
]

export function HowItWorks() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <span className="font-mono text-xs uppercase tracking-wider text-[#106BE3]">
            How it works
          </span>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            From repo to running prototype in under a minute.
          </h2>
        </div>

        <ol className="mt-12 grid gap-6 md:grid-cols-3">
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
