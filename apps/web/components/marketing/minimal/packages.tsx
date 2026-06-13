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
    pitch: "Live controls, built into the desktop app.",
    body: "Expose values as adjustable knobs right in the app — spacing, colors, text, anything. Change them live and see updates instantly. The desktop app makes it seamless.",
    bullets: [
      "Integrated into the native UI",
      "Real-time updates, no reload",
      "Agent adds them on demand",
      "Commit changes back to code",
    ],
  },
  {
    name: "@screenplay.space/state",
    href: "https://www.npmjs.com/package/@screenplay.space/state",
    pitch: "Local state that syncs when you want it to.",
    body: "Manage prototype state locally in the desktop app. When you're ready to share, state syncs across viewers. Forms, toggles, route params — it all just works.",
    bullets: [
      "Local-first, syncs on demand",
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
          The desktop app uses the same open source packages.
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
