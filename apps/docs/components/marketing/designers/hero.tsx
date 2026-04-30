import { Button } from "@workspace/ui/components/button"
import { appUrl } from "@/lib/app-url"
import { DesignerCanvasMockup } from "./canvas-mockup"

export function DesignerHero() {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <BackgroundGlow />
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 pb-20 pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pt-24">
        <div className="flex flex-col justify-center">
          <span className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-[#106BE3]" />
            <span>For designers prototyping in code</span>
          </span>
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Work on your code prototype{" "}
            <span className="text-[#106BE3]">
              like it&apos;s a design file.
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
            Screenplay is a collaborative canvas for designers who build in
            code. Drop your routes onto an infinite surface, leave notes and
            comments on the actual UI, sync state across every viewer, and
            tune the design with fine-grained knobs — all in real time.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={appUrl}>
              <Button size="lg" className="bg-[#106BE3] hover:bg-[#0d57b8]">
                Open Screenplay
              </Button>
            </a>
            <a href="#knobs">
              <Button size="lg" variant="outline">
                See the designer features
              </Button>
            </a>
          </div>
          <p className="mt-6 max-w-md text-xs text-muted-foreground/80">
            The thing you ship is the thing you review. No screenshots, no
            rebuilding the component in a second tool.
          </p>
        </div>

        <div className="lg:pl-4">
          <DesignerCanvasMockup />
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
