import { cn } from "@workspace/ui/lib/utils"

/** Section header styled like a screenplay scene heading. */
export function SectionHeading({
  slug,
  title,
  body,
  align = "left",
  className,
}: {
  slug: string
  title: React.ReactNode
  body?: React.ReactNode
  align?: "left" | "center"
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col",
        align === "center" && "items-center text-center",
        className
      )}
    >
      <span className="font-screenplay text-[13px] tracking-wide text-[#106BE3] uppercase dark:text-[#6AA8FF]">
        {slug}
      </span>
      <h2 className="mt-4 max-w-3xl text-3xl leading-[1.08] font-semibold tracking-[-0.03em] text-balance sm:text-5xl">
        {title}
      </h2>
      {body ? (
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-balance text-muted-foreground sm:text-lg">
          {body}
        </p>
      ) : null}
    </div>
  )
}
