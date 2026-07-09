import Link from "next/link"
import { githubUrl } from "@/lib/app-url"

export function MinimalHero() {
  return (
    <section className="brutal-border-b">
      <div className="mx-auto w-full max-w-5xl px-6 pt-20 pb-20 sm:pt-28 sm:pb-28">
        <span className="brutal-border-2 inline-block bg-[var(--brutal-yellow)] px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.18em]">
          Screenplay // multiplayer canvas
        </span>
        <h1 className="mt-8 max-w-4xl text-balance text-5xl font-extrabold uppercase leading-[0.95] tracking-tight text-[var(--brutal-ink)] sm:text-7xl">
          See multiple{" "}
          <span className="bg-[var(--brutal-blue)] px-2 text-white [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">
            branches
          </span>{" "}
          at once.
        </h1>
        <p className="mt-8 max-w-2xl text-balance text-base font-medium leading-relaxed text-[var(--brutal-ink)] sm:text-lg">
          AI agents work one branch at a time. Screenplay runs each branch in
          its own sandbox and shows them side by side on a canvas. No more git
          checkout and rebuild. No more choosing between alternatives without
          seeing them together.
        </p>

        <div className="mt-12 flex flex-wrap items-center gap-4 font-mono text-sm font-bold uppercase tracking-[0.08em]">
          <Link
            href="#how"
            className="brutal-border brutal-shadow brutal-press bg-[var(--brutal-ink)] px-6 py-3 text-[var(--brutal-paper)]"
          >
            How it works →
          </Link>
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="brutal-border brutal-shadow brutal-press bg-white px-6 py-3 text-[var(--brutal-ink)]"
          >
            GitHub ↗
          </a>
        </div>
      </div>
    </section>
  )
}
