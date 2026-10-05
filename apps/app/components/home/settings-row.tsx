import { CheckCircleIcon, type Icon } from "@workspace/ui/components/icons"
import { Badge } from "@workspace/ui/components/badge"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

/** The frame every settings row shares, inside a {@link SettingsRowList}. */
const ROW_FRAME = "flex min-h-14 items-center gap-3 px-4 py-3"

/** The bordered group settings rows sit in, one divider between each. */
const GROUP_FRAME = "divide-y rounded-lg border"

/**
 * One settings row (issues #736, #782): titled by the thing (Claude Code, a
 * preset's project), with its state as a chip beside the title, a muted facts
 * line under it (version, path), and trailing actions. GitHub, coding agents,
 * Project presets and Account all render their rows, skeletons and load errors
 * through this, so every section reads as one list.
 *
 * `status` marks the chip: `on` gets a green check and is only for something that works
 * (signed in, connected); `off` is neutral. `icon` is for rows that stand for a
 * problem (a load error), not decoration.
 */
export function SettingsRow({
  icon: Icon,
  iconClassName,
  media,
  title,
  marker,
  state,
  status = "off",
  detail,
  action,
  role,
  wrap = false,
}: {
  icon?: Icon
  iconClassName?: string
  /** Leading content in place of an icon (an avatar). */
  media?: React.ReactNode
  title: React.ReactNode
  /** A small mark right after the title (a customized repository's dot). */
  marker?: React.ReactNode
  /** The row's state, drawn as a chip after the title ("Signed in"). */
  state?: React.ReactNode
  status?: "on" | "off"
  detail?: React.ReactNode
  action?: React.ReactNode
  role?: React.AriaRole
  /**
   * Let a sentence-long title wrap at regular weight instead of truncating
   * (a canvas memory entry), for rows titled by text rather than a name.
   */
  wrap?: boolean
}) {
  return (
    <div className={ROW_FRAME} role={role}>
      {Icon && (
        <Icon
          className={cn("size-4 shrink-0 text-muted-foreground", iconClassName)}
        />
      )}
      {media}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "min-w-0 text-sm",
              wrap ? "break-words whitespace-pre-wrap" : "truncate font-medium"
            )}
          >
            {title}
          </span>
          {marker}
          {state && (
            <Badge
              variant="outline"
              className={cn(
                "shrink-0 gap-1 font-normal",
                status === "on" ? "text-success" : "text-muted-foreground"
              )}
            >
              {status === "on" && (
                <CheckCircleIcon aria-hidden className="size-3 text-success" />
              )}
              {state}
            </Badge>
          )}
        </div>
        {detail && (
          <div className="truncate text-sm text-muted-foreground">{detail}</div>
        )}
      </div>
      {action && (
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      )}
    </div>
  )
}

/** A bordered group of {@link SettingsRow}s with a divider between each. */
export function SettingsRowList({ children }: { children: React.ReactNode }) {
  return <div className={GROUP_FRAME}>{children}</div>
}

/**
 * {@link SettingsRow}'s loading stand-in: the same group, frame and rhythm, so
 * a section keeps its height while it checks or loads, rather than showing a
 * spinner line.
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
    <div className={GROUP_FRAME} role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={ROW_FRAME} aria-hidden>
          {/* A 20px title line over a 16px facts line, 2px apart. */}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-32" />
            </div>
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-48 max-w-full" />
            </div>
          </div>
          <Skeleton className="h-7 w-20 shrink-0" />
        </div>
      ))}
    </div>
  )
}
