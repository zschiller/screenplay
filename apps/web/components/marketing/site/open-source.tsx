import { cn } from "@workspace/ui/lib/utils"

import { githubUrl, knobsNpmUrl, stateNpmUrl } from "@/lib/app-url"
import { measure } from "./editorial"
import { SectionHeading } from "./section-heading"

const packages = [
  {
    name: "@screenplay.space/knobs",
    href: knobsNpmUrl,
    pitch: "Live controls for any prototype.",
  },
  {
    name: "@screenplay.space/state",
    href: stateNpmUrl,
    pitch: "One state, every frame, every viewer.",
  },
]

export function OpenSource() {
  return (
    <section
      id="open-source"
      className={cn(measure, "scroll-mt-20 pt-[clamp(72px,10vw,140px)]")}
    >
      <SectionHeading slug="Credits" title="Open source, down to the props." />
      <div className="mt-12 grid gap-12 md:grid-cols-2">
        <div className="flex flex-col items-start gap-5">
          <p className="max-w-[52ch] text-lg leading-relaxed text-muted-foreground sm:text-[19px]">
            Screenplay is MIT licensed. Run the desktop app, self-host the
            multiplayer web app, or swap in your own sandbox, blob store and
            models. The two packages that make prototypes tweakable are on npm.
          </p>
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-sm underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
          >
            github.com/zschiller/screenplay
          </a>
        </div>
        <div>
          {packages.map((p) => (
            <a
              key={p.name}
              href={p.href}
              target="_blank"
              rel="noreferrer"
              className="group flex flex-col gap-1.5 border-t border-border py-4.5 last:border-b"
            >
              <code className="font-mono text-sm font-medium">{p.name}</code>
              <span className="text-muted-foreground transition-colors group-hover:text-foreground">
                {p.pitch}
              </span>
              <code className="font-mono text-xs text-muted-foreground">
                $ npm i {p.name}
              </code>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
