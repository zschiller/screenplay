import { notFound } from "next/navigation"

import { CanvasExcerpt } from "@/components/marketing/excerpts/canvas"
import { Wordmark } from "@/components/marketing/wordmark"

/*
 * The link preview (P14), laid out at 1200×630 so `pnpm og-image` can capture
 * it into app/opengraph-image.jpg: the hero's headline over Fig. 1, which runs
 * off the bottom edge. It draws the page's own excerpt, so re-run the script
 * whenever Fig. 1 changes. Only served by `next dev`.
 */
export default function OgImage() {
  if (process.env.NODE_ENV === "production") notFound()

  return (
    <div
      id="og"
      className="relative flex h-[630px] w-[1200px] flex-col overflow-hidden bg-background px-14 pt-12 text-foreground"
    >
      <div className="flex items-end justify-between gap-8">
        <h1 className="font-headline text-[88px] leading-[0.92] font-normal tracking-[-0.025em] whitespace-nowrap">
          Every branch, <em>side by side</em>.
        </h1>
        <div className="pb-2.5">
          <Wordmark />
        </div>
      </div>
      <div className="mt-10">
        <CanvasExcerpt />
      </div>
    </div>
  )
}
