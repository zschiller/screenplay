import { Button } from "@workspace/ui/components/button"
import { githubUrl } from "@/lib/app-url"

export function DesignerCTA() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-28">
        <div className="relative overflow-hidden rounded-3xl border border-border bg-card px-6 py-16 text-center sm:px-10">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.18]"
            style={{
              background:
                "radial-gradient(circle at 50% 0%, #106BE3 0%, transparent 55%)",
            }}
          />
          <div className="relative">
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
              Bring the design loop back.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-balance text-muted-foreground">
              Point Screenplay at your repo and the next prototype you build
              is one link away from a real review.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a href={githubUrl} target="_blank" rel="noreferrer">
                <Button size="lg" className="bg-[#106BE3] hover:bg-[#0d57b8]">
                  View on GitHub
                </Button>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
