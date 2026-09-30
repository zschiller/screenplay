import { cn } from "@workspace/ui/lib/utils"

import { releasesUrl } from "@/lib/app-url"
import { AppleLogo } from "../header"
import { buttonClass, measure } from "./editorial"

export function CTA() {
  return (
    <section className={cn(measure, "py-[clamp(88px,12vw,160px)]")}>
      <h2 className="max-w-[14ch] font-heading text-[clamp(40px,6.2vw,88px)] leading-none font-normal tracking-[-0.035em] text-balance">
        Try it on your own repository.
      </h2>
      <p className="mt-5.5 max-w-[48ch] text-lg leading-relaxed text-muted-foreground sm:text-[19px]">
        Download Screenplay, add a repository, and ask your agent for a few
        versions of a change. Review them side by side.
      </p>
      <div className="mt-8 flex flex-wrap gap-3 max-sm:flex-col">
        <a
          href={releasesUrl}
          target="_blank"
          rel="noreferrer"
          className={buttonClass("solid", "lg")}
        >
          <AppleLogo className="size-4 -translate-y-px" />
          Download for Mac
        </a>
        <a href="#self-hosting" className={buttonClass("outline", "lg")}>
          Host it for your team
        </a>
      </div>
    </section>
  )
}
