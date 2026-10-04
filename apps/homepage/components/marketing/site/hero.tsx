import { cn } from "@workspace/ui/lib/utils"

import { downloadUrl } from "@/lib/app-url"
import { AppleLogo } from "../header"
import { CanvasExcerpt } from "../excerpts/canvas"
import { buttonClass, measure, monoLabel } from "./editorial"
import { HeroStage } from "./hero-stage"

export function Hero() {
  return (
    <section>
      <HeroStage>
        <div className={cn(measure, "pb-[clamp(40px,6vw,80px)]")}>
          <h1
            data-veil
            className="font-headline text-[clamp(56px,10.5vw,148px)] leading-[0.92] font-normal tracking-[-0.025em] text-balance"
          >
            From idea to code,
            <br />
            <em>on one canvas</em>.
          </h1>
          <div className="mt-14 grid items-end gap-6 md:mb-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-12">
            <p className="max-w-[36ch] text-lg leading-[1.45] sm:text-[22px]">
              Coding agents plan, mock up and build from your own repo, with
              every version live side by side.
            </p>
            {/* From md up the buttons are centred on the lede, and their note
                hangs below them, out of the grid's way. */}
            <div className="relative">
              <div className="flex flex-wrap gap-3 max-sm:flex-col">
                <a href={downloadUrl} className={buttonClass("solid", "lg")}>
                  <AppleLogo className="size-4 -translate-y-px" />
                  Download for Mac
                </a>
                <a
                  href="#self-hosting"
                  className={buttonClass("outline", "lg")}
                >
                  Host it for your team
                </a>
              </div>
              <p className="mt-3 w-fit text-sm text-muted-foreground md:absolute md:top-full md:left-0">
                For Macs with Apple Silicon
              </p>
            </div>
          </div>
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
          <span>Fig. 1 · Three versions on one canvas</span>
        </figcaption>
      </figure>
    </section>
  )
}
