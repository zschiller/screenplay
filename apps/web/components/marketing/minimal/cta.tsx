import { githubUrl } from "@/lib/app-url"

export function MinimalCTA() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto w-full max-w-3xl px-6 py-24 sm:py-32">
        <h2 className="text-balance text-3xl font-medium tracking-tight sm:text-4xl">
          Bring the design loop back.
        </h2>
        <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
          Point Screenplay at your repo and the next prototype you build is
          one link away from a real review.
        </p>
        <div className="mt-8 flex items-center gap-6 text-sm">
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline decoration-border underline-offset-[6px] transition-colors hover:decoration-foreground"
          >
            View on GitHub ↗
          </a>
        </div>
      </div>
    </section>
  )
}
