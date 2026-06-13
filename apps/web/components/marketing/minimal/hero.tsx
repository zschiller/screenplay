import Link from "next/link"
import { githubUrl } from "@/lib/app-url"

export function MinimalHero() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto w-full max-w-3xl px-6 pt-28 pb-24 sm:pt-36 sm:pb-32">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Screenplay
        </span>
        <h1 className="mt-6 text-balance text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
          Explore every direction at once.
        </h1>
        <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
          AI agents work one branch at a time. Screenplay lets you explore
          broadly — spin up multiple branches in parallel, see every direction
          side by side, and compare alternatives on a single canvas. Stop
          toggling between tabs. Start seeing the whole design space.
        </p>

        <div className="mt-10 flex items-center gap-6 text-sm">
          <Link
            href="#how"
            className="text-foreground underline decoration-border underline-offset-[6px] transition-colors hover:decoration-foreground"
          >
            How it works
          </Link>
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            GitHub ↗
          </a>
        </div>
      </div>
    </section>
  )
}
