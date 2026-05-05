import { DesignerCanvasMockup } from "./canvas-mockup"

export function DesignerHero() {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <BackgroundGlow />
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 pb-20 pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pt-24">
        <div className="flex flex-col justify-center">
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            AI-built prototypes are easy to make.{" "}
            <span className="text-[#106BE3]">
              Reviewing them is harder than it should be.
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
            Localhost runs on one machine. Agent chats stay private. Branches
            can&apos;t be viewed side by side. Screen recordings aren&apos;t
            a substitute for a design review. Screenplay places AI-built
            prototypes on a multiplayer canvas, with every direction laid
            out, every screen reviewable, and every viewer in sync.
          </p>
          <p className="mt-8 max-w-md text-xs text-muted-foreground/80">
            Built for designers using Cursor, Claude Code, V0, or Bolt —
            anywhere a prototype runs as real code on a remote machine.
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
