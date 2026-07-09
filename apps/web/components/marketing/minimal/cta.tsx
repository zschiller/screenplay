import { githubUrl } from "@/lib/app-url"

export function MinimalCTA() {
  return (
    <section>
      <div className="mx-auto w-full max-w-3xl px-6 py-20 sm:py-28">
        <div className="neu-raised-lg rounded-[2rem] bg-background px-8 py-14 text-center sm:px-14 sm:py-20">
          <h2 className="text-balance text-3xl font-medium tracking-tight sm:text-4xl">
            Try it.
          </h2>
          <p className="mx-auto mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
            Download the desktop app. Point it at a repo. Ask the agent for
            three versions of something. See them all at once.
          </p>
          <div className="mt-9 flex items-center justify-center text-sm">
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="neu-pressable rounded-xl bg-background px-6 py-3 font-medium text-primary"
            >
              Download on GitHub ↗
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
