import { githubUrl } from "@/lib/app-url"

export function MinimalCTA() {
  return (
    <section className="brutal-border-b">
      <div className="mx-auto w-full max-w-5xl px-6 py-20 sm:py-28">
        <div className="brutal-border brutal-shadow bg-[var(--brutal-blue)] p-8 text-white sm:p-14">
          <h2 className="text-balance text-4xl font-extrabold uppercase leading-[0.95] tracking-tight sm:text-6xl">
            Try it.
          </h2>
          <p className="mt-6 max-w-md text-base font-medium leading-relaxed text-white/90">
            Download the desktop app. Point it at a repo. Ask the agent for
            three versions of something. See them all at once.
          </p>
          <div className="mt-10">
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="brutal-border brutal-shadow-yellow brutal-press inline-block bg-white px-8 py-4 font-mono text-sm font-bold uppercase tracking-[0.08em] text-[var(--brutal-ink)]"
            >
              Download on GitHub ↗
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
