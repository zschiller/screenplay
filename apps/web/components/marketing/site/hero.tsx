import { cn } from "@workspace/ui/lib/utils"

import { githubUrl, releasesUrl } from "@/lib/app-url"
import { AppleLogo } from "../header"
import heroDark from "../shots/hero.dark.webp"
import heroLight from "../shots/hero.light.webp"
import { buttonClass, measure, monoLabel, ProductShot } from "./editorial"

export function Hero() {
  return (
    <section>
      <div className={cn(measure, "pt-[clamp(56px,9vw,120px)]")}>
        <p className={cn(monoLabel, "text-muted-foreground")}>
          Open source · Works with Claude Code, Codex &amp; opencode
        </p>
        <h1 className="mt-7 font-heading text-[clamp(56px,10.5vw,148px)] leading-[0.92] font-normal tracking-[-0.025em] text-balance">
          Every branch, <Selected label="branch 3 of 3">running</Selected> at
          once.
        </h1>
        <div className="mt-14 grid items-end gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:gap-12">
          <p className="max-w-[36ch] text-lg leading-[1.45] sm:text-[22px]">
            Screenplay runs each coding agent on its own branch, in its own
            sandbox, and shows every result as a live frame on one canvas.
            Compare them side by side and ship the one that works.
          </p>
          <div className="flex flex-wrap gap-3">
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

      <figure className={cn(measure, "mt-12")}>
        <ProductShot
          light={heroLight}
          dark={heroDark}
          priority
          sizes="(min-width: 1152px) 1088px, 100vw"
          alt="The Screenplay canvas: Workspaces and frames in the sidebar, live desktop and mobile previews of the Northwind site, and the agent's chat on the right."
        />
        <figcaption
          className={cn(
            monoLabel,
            "mt-2.5 flex justify-between gap-4 text-muted-foreground"
          )}
        >
          <span>Fig. 1 · Three Workspaces on one canvas</span>
          <span className="max-sm:hidden">The real app</span>
        </figcaption>
      </figure>
    </section>
  )
}

/**
 * A word selected the way a frame is on the canvas: the magenta box, its four
 * handles, and a label tab underneath.
 */
function Selected({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  const handle =
    "absolute size-2.5 border-2 border-selection bg-background max-sm:size-2"
  return (
    <span className="select-in outline-selection relative inline-block px-[0.06em] italic outline-2 -outline-offset-2">
      {children}
      <span aria-hidden className={cn(handle, "-top-[5px] -left-[5px]")} />
      <span aria-hidden className={cn(handle, "-top-[5px] -right-[5px]")} />
      <span aria-hidden className={cn(handle, "-bottom-[5px] -left-[5px]")} />
      <span aria-hidden className={cn(handle, "-right-[5px] -bottom-[5px]")} />
      <span
        aria-hidden
        className="bg-selection absolute top-full -left-0.5 mt-1.5 px-1.5 py-1 font-mono text-xs leading-none tracking-[0.02em] whitespace-nowrap text-white not-italic"
      >
        {label}
      </span>
    </span>
  )
}
