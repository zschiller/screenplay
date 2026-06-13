import { knobsNpmUrl, stateNpmUrl } from "@/lib/app-url"

type Pkg = {
  name: string
  href: string
  pitch: string
  body: string
  bullets: string[]
}

const packages: Pkg[] = [
  {
    name: "@screenplay.space/knobs",
    href: "https://www.npmjs.com/package/@screenplay.space/knobs",
    pitch: "Refine values across multiple branches at once.",
    body: "Expose spacing, colors, or copy as adjustable knobs. Change them live and watch every branch update in parallel. See which direction works best without re-prompting the agent.",
    bullets: [
      "Live updates across all artboards",
      "Real components, real state",
      "Agent adds them on demand",
      "Commit the winner back to code",
    ],
  },
  {
    name: "@screenplay.space/state",
    href: "https://www.npmjs.com/package/@screenplay.space/state",
    pitch: "Every branch sees the same state.",
    body: "Forms, toggles, route params — share any value and it syncs across artboards. Compare how different branches handle the same state without manual setup.",
    bullets: [
      "Shared state across branches",
      "Conflict-free (CRDTs)",
      "Persists per artboard",
      "Works with any state library",
    ],
  },
]

export function MinimalPackages() {
  return (
    <section id="packages" className="border-b border-border/60 scroll-mt-16">
      <div className="mx-auto w-full max-w-3xl px-6 py-24 sm:py-28">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Built on open source
        </span>
        <h2 className="mt-4 text-balance text-2xl font-medium tracking-tight sm:text-3xl">
          Two packages that make parallel exploration real.
        </h2>

        <div className="mt-14 grid gap-12 sm:grid-cols-2 sm:gap-10">
          {packages.map((pkg) => (
            <div key={pkg.name} className="flex flex-col">
              <a
                href={pkg.href}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-foreground transition-colors hover:text-[#106BE3]"
              >
                {pkg.name} ↗
              </a>
              <h3 className="mt-3 text-base font-medium text-foreground">
                {pkg.pitch}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {pkg.body}
              </p>
              <ul className="mt-5 space-y-1.5 text-sm text-muted-foreground">
                {pkg.bullets.map((b) => (
                  <li key={b} className="flex items-baseline gap-3">
                    <span
                      aria-hidden
                      className="font-mono text-[11px] text-muted-foreground/60"
                    >
                      —
                    </span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-14 text-xs text-muted-foreground">
          Install:{" "}
          <a
            href={knobsNpmUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-foreground/80 transition-colors hover:text-foreground"
          >
            npm i @screenplay.space/knobs
          </a>
          <span className="mx-2 text-muted-foreground/50">·</span>
          <a
            href={stateNpmUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-foreground/80 transition-colors hover:text-foreground"
          >
            npm i @screenplay.space/state
          </a>
        </p>
      </div>
    </section>
  )
}
