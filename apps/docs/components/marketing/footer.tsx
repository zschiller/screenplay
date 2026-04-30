import { githubUrl, knobsNpmUrl, stateNpmUrl } from "@/lib/app-url"
import { Wordmark } from "./wordmark"

export function Footer() {
  return (
    <footer className="bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <Wordmark />
          <p className="text-xs text-muted-foreground">
            MIT licensed. Built on a canvas.
          </p>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            GitHub
          </a>
          <a
            href={stateNpmUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            @screenplay.space/state
          </a>
          <a
            href={knobsNpmUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            @screenplay.space/knobs
          </a>
        </nav>
      </div>
    </footer>
  )
}
