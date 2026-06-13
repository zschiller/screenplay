type Step = {
  num: string
  title: string
  body: string
}

const steps: Step[] = [
  {
    num: "01",
    title: "Download and install",
    body: "Install the native desktop app for macOS, Windows, or Linux. Launch it like any other app on your machine — no browser required.",
  },
  {
    num: "02",
    title: "Build with the agent",
    body: "Each artboard runs a coding agent inside its own sandbox. Work locally with native performance, and your changes sync automatically when you're ready.",
  },
  {
    num: "03",
    title: "Compare and refine",
    body: "Branch side by side in the desktop app. Each artboard is its own direction, all visible at once. Adjust values with live controls and see changes instantly.",
  },
  {
    num: "04",
    title: "Share when ready",
    body: "Export a shareable link when you want feedback. Your team can view and comment on your work without installing anything.",
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
          A native app that works the way you think.
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
