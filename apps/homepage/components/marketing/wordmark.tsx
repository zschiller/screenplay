import { ScreenplayMark } from "@workspace/ui/components/screenplay-mark"

/** The logo lockup: the static mark and "Screenplay" in Unbounded 600. */
export function Wordmark({ size = 24 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <ScreenplayMark width={size} height={size} className="shrink-0" />
      <span className="font-heading text-[19px] leading-none font-semibold tracking-[-0.03em]">
        Screenplay
      </span>
    </span>
  )
}
