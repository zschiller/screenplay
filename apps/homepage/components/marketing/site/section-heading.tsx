import { cn } from "@workspace/ui/lib/utils"

import { monoLabel } from "./editorial"

/**
 * A section's eyebrow, serif title and intro. The story sections (Problem,
 * How it works) take the large title; reference sections (Before you build, Features,
 * Self-hosting, FAQ) a smaller one.
 */
export function SectionHeading({
  slug,
  title,
  body,
  tier = "story",
  className,
}: {
  slug: string
  title: React.ReactNode
  body?: React.ReactNode
  tier?: "story" | "reference"
  className?: string
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      <span className={cn(monoLabel, "text-info")}>{slug}</span>
      <h2
        className={cn(
          "mt-4.5 font-heading font-normal tracking-[-0.03em] text-balance",
          tier === "story"
            ? "max-w-[18ch] text-[clamp(30px,4.5vw,56px)] leading-[1.05]"
            : "max-w-[22ch] text-[clamp(26px,3.2vw,40px)] leading-[1.1]"
        )}
      >
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
