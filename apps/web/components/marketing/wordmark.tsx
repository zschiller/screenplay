import { Instrument_Serif } from "next/font/google"

import { ScreenplayMark } from "@workspace/ui/components/screenplay-mark"
import { cn } from "@workspace/ui/lib/utils"

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400" })

/** The logo lockup: the static mark and "Screenplay" in Instrument Serif. */
export function Wordmark({ size = 24 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <ScreenplayMark width={size} height={size} className="shrink-0" />
      <span className={cn(serif.className, "text-[26px] leading-none")}>
        Screenplay
      </span>
    </span>
  )
}
