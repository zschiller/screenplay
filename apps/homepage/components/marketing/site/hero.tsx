import { cn } from "@workspace/ui/lib/utils"

import { githubUrl, releasesUrl } from "@/lib/app-url"
import { AppleLogo } from "../header"
import { CanvasExcerpt } from "../excerpts/canvas"
import { buttonClass, measure, monoLabel } from "./editorial"
import { HeroStage } from "./hero-stage"

export function Hero() {
  return (
    <section>
      <HeroStage>
        <div
          className={cn(
            measure,
            "pt-[clamp(56px,9vw,120px)] pb-[clamp(40px,6vw,80px)]"
          )}
        >
          <p data-veil className={cn(monoLabel, "text-muted-foreground")}>
            Open source · Works with Claude Code, Codex &amp; opencode
          </p>
          <h1
            data-veil
            className="font-wordmark mt-7 text-[clamp(56px,10.5vw,148px)] leading-[0.92] font-normal tracking-[-0.025em] text-balance"
          >
            Every branch, <em>side by side</em>.
          </h1>
          <div className="mt-14 grid items-end gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:gap-12">
            <p
              data-veil
              className="max-w-[36ch] text-lg leading-[1.45] sm:text-[22px]"
            >
              Screenplay runs each coding agent on its own branch, in its own
              sandbox, and shows every result as a live frame on one canvas.
              Compare them and ship the one that works.
            </p>
            <div data-veil className="flex flex-wrap gap-3">
              <a
                href={releasesUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonClass("solid", "lg")}
              >
                <AppleLogo className="size-4 -translate-y-px" />
                Download for Mac
              </a>
              <a
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonClass("outline", "lg")}
              >
                Star on GitHub
              </a>
            </div>
          </div>
          <p
            data-veil
            className={cn(
              monoLabel,
              "mt-7 flex flex-wrap gap-x-4.5 gap-y-1.5 text-muted-foreground"
            )}
          >
            <span>Apple Silicon</span>
            <span>Runs fully local</span>
            <span>Free &amp; MIT licensed</span>
          </p>
        </div>
      </HeroStage>

      <figure className={cn(measure, "mt-12")}>
        <CanvasExcerpt />
        <figcaption
          className={cn(
            monoLabel,
            "mt-2.5 flex justify-between gap-4 text-muted-foreground"
          )}
        >
          <span>Fig. 1 · Three Workspaces on one canvas</span>
        </figcaption>
      </figure>
    </section>
  )
}
