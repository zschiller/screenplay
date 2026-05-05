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
          A multiplayer canvas for AI-built prototypes.
        </h1>
        <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
          Localhost runs on one machine. Branches don&apos;t sit side by
          side. Screen recordings aren&apos;t a substitute for review.
          Screenplay puts every direction on a shared canvas, with state
          and cursors synced.
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
