import type { LucideIcon } from "lucide-react"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

/** The row frame every settings panel shares: icon, text, trailing action. */
const ROW_FRAME = "flex items-center gap-3 rounded-lg border px-4 py-3"

/**
 * One settings row (issue #736): an icon, a title with an optional status dot, a
 * muted detail line, and a trailing action. GitHub, coding agents and Project
 * presets all render their rows, skeletons and load errors through this, so the
 * three panels read as one list.
 *
 * `status` draws the dot from the status tokens: `on` for connected/ready, `off`
 * for anything that still needs setting up. Omit it for rows with no state.
 */
export function SettingsRow({
  icon: Icon,
  iconClassName,
  title,
  status,
  detail,
  action,
  role,
}: {
  icon: LucideIcon
  iconClassName?: string
  title: React.ReactNode
  status?: "on" | "off"
  detail?: React.ReactNode
  action?: React.ReactNode
  role?: React.AriaRole
}) {
  return (
    <div className={ROW_FRAME} role={role}>
      <Icon
        className={cn("size-5 shrink-0 text-muted-foreground", iconClassName)}
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-2">
          {status && (
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                status === "on" ? "bg-success" : "bg-muted-foreground/40"
              )}
              aria-hidden
            />
          )}
          <span className="truncate text-sm font-medium">{title}</span>
        </div>
        {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      </div>
      {action && (
        <div className="flex shrink-0 items-center gap-1">{action}</div>
      )}
    </div>
  )
}

/** A stack of {@link SettingsRow}s, spaced the same in every panel. */
export function SettingsRowList({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>
}

/**
 * {@link SettingsRow}'s loading stand-in: the same frame and rhythm, so a panel
 * keeps its height while it checks or loads, rather than showing a spinner line.
 */
export function SettingsRowSkeleton({
  label,
  count = 1,
}: {
  /** What is loading, for screen readers ("Checking coding agents…"). */
  label: string
  count?: number
}) {
  return (
    <div className="space-y-2" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={ROW_FRAME} aria-hidden>
          <Skeleton className="size-5 shrink-0 rounded-md" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3.5 w-64 max-w-full" />
          </div>
          <Skeleton className="h-7 w-24 shrink-0" />
        </div>
      ))}
    </div>
  )
}
