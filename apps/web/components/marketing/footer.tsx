import { githubUrl, knobsNpmUrl, stateNpmUrl } from "@/lib/app-url"

export function Footer() {
  return (
    <footer className="bg-[var(--brutal-ink)] text-[var(--brutal-paper)]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <span className="font-mono text-sm font-bold uppercase tracking-tight text-[var(--brutal-paper)]">
            Screenplay
            <span className="text-[var(--brutal-blue)]">.space</span>
          </span>
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--brutal-paper)]/60">
            MIT licensed // built on a canvas.
          </p>
        </div>
        <nav className="flex flex-wrap items-center gap-3 font-mono text-xs font-bold uppercase tracking-[0.08em]">
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="brutal-border-2 border-white px-3 py-1.5 transition-colors hover:bg-[var(--brutal-yellow)] hover:text-[var(--brutal-ink)]"
          >
            GitHub
          </a>
          <a
            href={stateNpmUrl}
            target="_blank"
            rel="noreferrer"
            className="brutal-border-2 border-white px-3 py-1.5 lowercase transition-colors hover:bg-[var(--brutal-blue)]"
          >
            @screenplay.space/state
          </a>
          <a
            href={knobsNpmUrl}
            target="_blank"
            rel="noreferrer"
            className="brutal-border-2 border-white px-3 py-1.5 lowercase transition-colors hover:bg-[var(--brutal-blue)]"
          >
            @screenplay.space/knobs
          </a>
        </nav>
      </div>
    </footer>
  )
}
