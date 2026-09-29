import {
  docsUrl,
  githubUrl,
  knobsNpmUrl,
  releasesUrl,
  stateNpmUrl,
} from "@/lib/app-url"
import { cn } from "@workspace/ui/lib/utils"
import { measure, monoLabel } from "./site/editorial"
import { Wordmark } from "./wordmark"

const columns = [
  {
    title: "Product",
    links: [
      { href: "#how", label: "How it works" },
      { href: "#features", label: "Features" },
      { href: releasesUrl, label: "Download", external: true },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: docsUrl, label: "Docs" },
      { href: githubUrl, label: "GitHub", external: true },
      {
        href: knobsNpmUrl,
        label: "@screenplay.space/knobs",
        external: true,
        mono: true,
      },
      {
        href: stateNpmUrl,
        label: "@screenplay.space/state",
        external: true,
        mono: true,
      },
    ],
  },
]

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div
        className={cn(
          measure,
          "grid gap-10 py-14 md:grid-cols-[1fr_auto_auto] md:gap-20"
        )}
      >
        <div className="flex flex-col gap-3">
          <Wordmark />
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
            A multiplayer canvas where every branch your agents write is live,
            side by side.
          </p>
          <p className={cn(monoLabel, "text-muted-foreground")}>
            Fade out. &nbsp;·&nbsp; MIT licensed
          </p>
        </div>
        {columns.map((col) => (
          <nav key={col.title} className="flex flex-col gap-3 text-sm">
            <span className={cn(monoLabel, "text-muted-foreground")}>
              {col.title}
            </span>
            {col.links.map((l) => (
              <a
                key={l.label}
                href={l.href}
                {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
                className={cn(
                  "text-muted-foreground transition-colors hover:text-foreground",
                  "mono" in l && l.mono && "font-mono text-xs"
                )}
              >
                {l.label}
              </a>
            ))}
          </nav>
        ))}
      </div>
    </footer>
  )
}
