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
import { CaretUpDownIcon } from "@workspace/ui/components/icons"

/**
 * The status at the end of a Mockup's label (#1310), opening the stock radio
 * menu. Styled like the frame label's "Set workspace" chooser (muted text and
 * an up-down caret), so it reads as a quiet setting beside the title.
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
          className="flex shrink-0 items-center outline-none focus-visible:outline-none"
          // Keep the press off the label's drag and select handlers.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-xs text-muted-foreground">
            {MOCKUP_STATUS_LABELS[status]}
          </span>
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
