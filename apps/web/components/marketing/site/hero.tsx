import { Apple } from "lucide-react"
import { githubUrl, releasesUrl } from "@/lib/app-url"
import { GitHubIcon } from "../header"
import { AppWindow, APP_HEIGHT, APP_WIDTH } from "./app-window"
import { Mascot } from "./mascot"
import { ScaleToFit } from "./scale-to-fit"

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[900px]"
        aria-hidden
      />
      <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-5 pt-20 text-center sm:px-8 sm:pt-28">
        <a
          href={githubUrl}
          target="_blank"
          rel="noreferrer"
          className="group inline-flex items-center gap-2 rounded-full border border-border bg-background/70 py-1 pr-3 pl-1 text-xs text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
        >
          <span className="rounded-full bg-[#106BE3] px-2 py-0.5 font-medium whitespace-nowrap text-white">
            Open source
          </span>
          <span className="sm:hidden">Claude Code, Codex &amp; more</span>
          <span className="max-sm:hidden">
            Works with Claude Code, Codex &amp; opencode
          </span>
          <span className="transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </a>

        <h1 className="mt-8 max-w-4xl text-[44px] leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-7xl">
          Every take, <span className="hero-underline">running</span> at once.
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-balance text-muted-foreground sm:text-xl">
          Screenplay gives each coding agent its own branch, its own sandbox,
          and a frame on a shared canvas. Ask for three directions, click
          through all three live, and ship the one that works.
        </p>

        <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
          <a
            href={releasesUrl}
            target="_blank"
            rel="noreferrer"
            className="flex h-12 items-center gap-2 rounded-full bg-foreground px-6 text-[15px] font-medium text-background shadow-lg shadow-black/10 transition-transform hover:-translate-y-0.5"
          >
            <Apple className="size-[18px] fill-current" strokeWidth={0} />
            Download for Mac
          </a>
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="flex h-12 items-center gap-2 rounded-full border border-border bg-background px-6 text-[15px] font-medium transition-colors hover:bg-muted"
          >
            <GitHubIcon />
            Star on GitHub
          </a>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Apple Silicon · Runs fully local · Free &amp; MIT licensed
        </p>
      </div>

      <div className="relative mx-auto mt-16 w-full max-w-6xl px-3 sm:mt-20 sm:px-8">
        {/* The mascot peeks over the edge of the product window. */}
        <div className="mascot-peek absolute -top-[44px] right-[12%] hidden sm:block">
          <Mascot size={64} />
        </div>
        {/* …and grips the window edge with two tiny paws. */}
        <div
          className="mascot-peek pointer-events-none absolute top-[-5px] right-[12%] z-20 hidden w-16 justify-between px-2.5 sm:flex"
          aria-hidden
        >
          <span className="h-2.5 w-3.5 rounded-full bg-[#106BE3] ring-2 ring-background" />
          <span className="h-2.5 w-3.5 rounded-full bg-[#106BE3] ring-2 ring-background" />
        </div>
        <ScaleToFit width={APP_WIDTH} height={APP_HEIGHT} className="relative">
          <AppWindow />
        </ScaleToFit>
      </div>
      <div className="h-20 sm:h-28" />
    </section>
  )
}
