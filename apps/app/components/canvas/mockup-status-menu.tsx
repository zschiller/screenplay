"use client"

import { MOCKUP_STATUSES, type MockupStatus } from "@/lib/types"
import { MOCKUP_STATUS_LABELS } from "@/lib/mockup-status"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  ArchiveIcon,
  CaretUpDownIcon,
  CheckCircleIcon,
  CircleIcon,
} from "@workspace/ui/components/icons"
import { cn } from "@workspace/ui/lib/utils"

/** Each status's icon, in the label and in the menu. */
const STATUS_ICONS = {
  "set-aside": ArchiveIcon,
  current: CircleIcon,
  built: CheckCircleIcon,
} satisfies Record<MockupStatus, unknown>

/** Built reads green, text and icon alike; the others stay muted. */
function statusColor(status: MockupStatus) {
  return status === "built" ? "text-success" : "text-muted-foreground"
}

/**
 * The status at the end of a Mockup's label (#1310), opening the stock radio
 * menu. Styled like the frame label's "Set workspace" chooser (muted text and
 * an up-down caret), with the status's icon in front. A set-aside Mockup also
 * strikes its name through (see `MockupLayer`).
 */
export function MockupStatusMenu({
  status,
  onChange,
}: {
  status: MockupStatus
  onChange: (status: MockupStatus) => void
}) {
  const Icon = STATUS_ICONS[status]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Status: ${MOCKUP_STATUS_LABELS[status]}`}
          className={cn(
            "flex shrink-0 items-center text-xs outline-none focus-visible:outline-none",
            statusColor(status)
          )}
          // Keep the press off the label's drag and select handlers.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <Icon aria-hidden className="mr-1 size-3 shrink-0" />
          <span>{MOCKUP_STATUS_LABELS[status]}</span>
          <CaretUpDownIcon
            aria-hidden
            className="ml-1 size-3 shrink-0 text-muted-foreground"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <DropdownMenuRadioGroup
          value={status}
          onValueChange={(v) => onChange(v as MockupStatus)}
        >
          {MOCKUP_STATUSES.map((s) => {
            const ItemIcon = STATUS_ICONS[s]
            return (
              <DropdownMenuRadioItem key={s} value={s}>
                <ItemIcon
                  aria-hidden
                  className={s === "built" ? "text-success" : undefined}
                />
                {MOCKUP_STATUS_LABELS[s]}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
