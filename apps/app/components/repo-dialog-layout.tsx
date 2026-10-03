import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

/**
 * The chrome both repository edit dialogs share (N5): Settings' Edit and
 * Duplicate, and a Canvas Repo's Edit. A header and source line, a hairline,
 * the fields in the dialog's one scroll, then a hairline and the footer pinned
 * under it. {@link REPO_DIALOG_CONTENT} goes on the `DialogContent`.
 */
export const REPO_DIALOG_CONTENT = "gap-0 overflow-hidden p-0 sm:max-w-lg"

export function RepoDialogHeader({
  title,
  description,
  source,
}: {
  title: React.ReactNode
  description: React.ReactNode
  /** The repository's `owner/name` (or folder), shown under the header. */
  source: string
}) {
  return (
    <>
      <DialogHeader className="px-5 pt-5 pb-3">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="min-w-0 truncate px-5 pb-3 text-sm">
        <span className="text-muted-foreground">Source </span>
        <span className="font-mono">{source}</span>
      </div>
    </>
  )
}

/** The dialog's only scroll, between two hairlines. */
export function RepoDialogBody({ children }: { children: React.ReactNode }) {
  return (
    // The max-height must land on the Radix viewport itself: shadcn hardcodes
    // h-full on it, so a max-h on the outer ScrollArea never creates a scroll
    // boundary (shadcn #296).
    <ScrollArea
      orientation="vertical"
      className="border-t [&>[data-slot=scroll-area-viewport]]:max-h-[60vh]"
    >
      <div className="flex flex-col gap-5 p-5">{children}</div>
    </ScrollArea>
  )
}

/**
 * The pinned footer. Anything in `notice` (an option for Save, an error) sits
 * above the buttons, under the same hairline, so fields scrolled under the
 * footer end at a line rather than running into it.
 */
export function RepoDialogFooter({
  notice,
  children,
}: {
  notice?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="border-t">
      {notice && <div className="flex flex-col gap-3 px-5 pt-4">{notice}</div>}
      <DialogFooter className="px-5 py-4">{children}</DialogFooter>
    </div>
  )
}
