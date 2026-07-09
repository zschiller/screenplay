import Link from "next/link"
import { githubUrl } from "@/lib/app-url"

export function MinimalHero() {
  return (
    <section>
      <div className="mx-auto w-full max-w-3xl px-6 pt-24 pb-24 sm:pt-32 sm:pb-32">
        <span className="neu-inset-sm inline-block rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Screenplay
        </span>
        <h1 className="mt-6 text-balance text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
          See multiple branches at once.
        </h1>
        <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
          AI agents work one branch at a time. Screenplay runs each branch
          in its own sandbox and shows them side by side on a canvas. No more
          git checkout and rebuild. No more choosing between alternatives
          without seeing them together.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-4 text-sm">
          <Link
            href="#how"
            className="neu-pressable rounded-xl bg-background px-5 py-2.5 font-medium text-primary"
          >
            How it works
          </Link>
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="neu-pressable rounded-xl bg-background px-5 py-2.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            GitHub ↗
          </a>
        </div>
      </div>
    </section>
  )
}
