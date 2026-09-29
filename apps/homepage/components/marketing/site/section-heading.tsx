import { cn } from "@workspace/ui/lib/utils"

import { monoLabel } from "./editorial"

/** A section's eyebrow, serif title and intro. */
export function SectionHeading({
  slug,
  title,
  body,
  className,
}: {
  slug: string
  title: React.ReactNode
  body?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      <span className={cn(monoLabel, "text-info")}>{slug}</span>
      <h2 className="mt-4.5 max-w-[18ch] font-heading text-[clamp(30px,4.5vw,56px)] leading-[1.05] font-normal tracking-[-0.03em] text-balance">
        {title}
      </h2>
      {body ? (
        <p className="mt-5.5 max-w-[52ch] text-lg leading-relaxed text-muted-foreground sm:text-[19px]">
          {body}
        </p>
      ) : null}
    </div>
  )
}
