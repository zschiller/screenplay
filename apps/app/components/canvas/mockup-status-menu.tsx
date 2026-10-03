"use client"

import { MOCKUP_STATUSES, type MockupStatus } from "@/lib/types"
import { MOCKUP_STATUS_LABELS } from "@/lib/mockup-status"
import { badgeVariants } from "@workspace/ui/components/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { CaretDownIcon } from "@workspace/ui/components/icons"
import { cn } from "@workspace/ui/lib/utils"

/**
 * The status at the end of a Mockup's label (#1310): a small outline Badge
 * that opens the stock radio menu. The label is muted and its caret a shade
 * stronger, so the status reads as a setting without competing with the title.
 */
export function MockupStatusMenu({
  status,
  onChange,
}: {
  status: MockupStatus
  onChange: (status: MockupStatus) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Status: ${MOCKUP_STATUS_LABELS[status]}`}
          className={cn(
            badgeVariants({ variant: "outline" }),
            "shrink-0 gap-1 pr-1.5 text-muted-foreground focus:ring-0 focus:ring-offset-0 focus-visible:ring-2"
          )}
          // Keep the press off the label's drag and select handlers.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {MOCKUP_STATUS_LABELS[status]}
          <CaretDownIcon
            aria-hidden
            className="size-3 text-[color-mix(in_oklab,var(--muted-foreground)_60%,var(--foreground))]"
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
          {MOCKUP_STATUSES.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {MOCKUP_STATUS_LABELS[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
