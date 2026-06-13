import { githubUrl } from "@/lib/app-url"

export function MinimalCTA() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto w-full max-w-3xl px-6 py-24 sm:py-32">
        <h2 className="text-balance text-3xl font-medium tracking-tight sm:text-4xl">
          Stop choosing. Start comparing.
        </h2>
        <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
          Download the desktop app and turn every AI conversation into a
          canvas of possibilities. Explore broadly, compare side by side,
          ship the best direction.
        </p>
        <div className="mt-8 flex items-center gap-6 text-sm">
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline decoration-border underline-offset-[6px] transition-colors hover:decoration-foreground"
          >
            Download on GitHub ↗
          </a>
        </div>
      </div>
    </section>
  )
}
