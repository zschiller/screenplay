import { Button } from "@workspace/ui/components/button"
import { appUrl } from "@/lib/app-url"
import { DesignerCanvasMockup } from "./canvas-mockup"

export function DesignerHero() {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <BackgroundGlow />
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 pb-20 pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pt-24">
        <div className="flex flex-col justify-center">
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Vibe coding prototypes is great.{" "}
            <span className="text-[#106BE3]">Reviewing them is broken.</span>
          </h1>
          <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
            Localhost is for one person. Agent chats don&apos;t share.
            Branches don&apos;t sit next to each other. Loom isn&apos;t a
            design review. Screenplay puts your AI-built prototypes on a
            multiplayer canvas — every direction laid out, every screen
            reviewable, every viewer in sync.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={appUrl}>
              <Button size="lg" className="bg-[#106BE3] hover:bg-[#0d57b8]">
                Open Screenplay
              </Button>
            </a>

          </div>
          <p className="mt-6 max-w-md text-xs text-muted-foreground/80">
            For designers using Cursor, Claude Code, V0, Bolt — anywhere your
            prototype is real running code on someone else&apos;s machine.
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
