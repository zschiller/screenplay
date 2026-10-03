import { cn } from "@workspace/ui/lib/utils"

/**
 * The frame a searchable list picker sits in when it fills a dialog: Open
 * GitHub repository (`AddRepositoryDialog`) and Settings' OpenCode models
 * (`HarnessModelsDialog`). The dialog has no padding of its own; the header,
 * the search box and the empty states sit on a 20px gutter, the list on 16px
 * so its rows' highlight lines up with the search box.
 */
export const PICKER_DIALOG_CLASS =
  "gap-0 overflow-hidden p-0 sm:max-w-md [&_[data-slot=command-group]:first-child]:pt-0 [&_[data-slot=command-group]:first-child_[cmdk-group-heading]]:pt-0 [&_[data-slot=command-input-wrapper]]:px-5 [&_[data-slot=command-input-wrapper]]:pb-3 [&_[data-slot=command-list]]:px-4 [&_[data-slot=command]]:rounded-none [&_[data-slot=command]]:p-0"

/** The picker dialog's header padding, on the same 20px gutter. */
export const PICKER_DIALOG_HEADER_CLASS = "px-5 pt-5 pb-2"

/**
 * A hairline under a picker's search box, shown only while the list below is
 * scrolled up under it. Goes first inside a `relative` wrapper around the
 * `CommandList`.
 */
export function ListScrollHairline({ shown }: { shown: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-border transition-opacity duration-150",
        shown ? "opacity-100" : "opacity-0"
      )}
    />
  )
}
