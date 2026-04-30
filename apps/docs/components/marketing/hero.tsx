import { Button } from "@workspace/ui/components/button"
import { appUrl, githubUrl } from "@/lib/app-url"
import { CanvasMockup } from "./canvas-mockup"

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <BackgroundGlow />
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 pb-20 pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pt-24">
        <div className="flex flex-col justify-center">
          <span className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-[#106BE3]" />
            <span>Open source · MIT licensed</span>
          </span>
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Design UIs on a canvas where every artboard runs{" "}
            <span className="text-[#106BE3]">live code</span>.
          </h1>
          <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
            Screenplay is an infinite canvas for product teams. Each artboard
            boots its own sandbox, syncs in real time across viewers, and ships
            with a Claude coding agent in the loop.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={appUrl}>
              <Button size="lg" className="bg-[#106BE3] hover:bg-[#0d57b8]">
                Open Screenplay
              </Button>
            </a>
            <a href={githubUrl} target="_blank" rel="noreferrer">
              <Button size="lg" variant="outline">
                <GithubGlyph />
                <span className="ml-2">View on GitHub</span>
              </Button>
            </a>
          </div>
          <p className="mt-6 font-mono text-xs text-muted-foreground">
            <span className="text-muted-foreground/70">$</span> npm i
            @screenplay.space/state @screenplay.space/knobs
          </p>
        </div>

        <div className="lg:pl-4">
          <CanvasMockup />
        </div>
      </div>
    </section>
  )
}

function BackgroundGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <div
        className="absolute -top-40 left-1/2 size-[700px] -translate-x-1/2 rounded-full opacity-[0.18] blur-3xl dark:opacity-[0.22]"
        style={{
          background:
            "radial-gradient(circle at center, #106BE3 0%, transparent 60%)",
        }}
      />
    </div>
  )
}

function GithubGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.55v-2.06c-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.74 2.67 1.24 3.32.95.1-.74.4-1.24.73-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18a10.93 10.93 0 0 1 5.74 0c2.18-1.49 3.14-1.18 3.14-1.18.63 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.7 5.39-5.27 5.68.41.36.78 1.05.78 2.12v3.14c0 .31.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  )
}
