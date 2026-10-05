import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { useCallback, useEffect, useRef, useState } from "react"
import { ListScrollHairline } from "@/components/picker-dialog"

/**
 * The chrome the repository dialogs share (N5): Settings' Edit and
 * Duplicate, a Canvas Repo's Edit, and Configure repository when adding one. A
 * header and source line, the fields in the dialog's one scroll, then the
 * footer pinned under it. Hairlines mark the scroll's edges only while fields
 * are scrolled under them, as in the picker dialogs.
 * {@link REPO_DIALOG_CONTENT} goes on the `DialogContent`.
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

/**
 * The dialog's only scroll. A hairline shows under the header once the fields
 * scroll up, and above the footer while more fields lie below.
 */
export function RepoDialogBody({ children }: { children: React.ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ above: false, below: false })

  const measure = useCallback(() => {
    const viewport = rootRef.current?.querySelector<HTMLElement>(
      "[data-slot=scroll-area-viewport]"
    )
    if (!viewport) return
    const { scrollTop, scrollHeight, clientHeight } = viewport
    const above = scrollTop > 0
    const below = scrollHeight - scrollTop - clientHeight > 1
    setEdges((prev) =>
      prev.above === above && prev.below === below ? prev : { above, below }
    )
  }, [])

  // Fields change height without a scroll (Advanced opening, an error line),
  // so re-measure on resize too.
  useEffect(() => {
    const viewport = rootRef.current?.querySelector<HTMLElement>(
      "[data-slot=scroll-area-viewport]"
    )
    if (!viewport || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild)
    return () => observer.disconnect()
  }, [measure])

  return (
    <div className="relative">
      <ListScrollHairline shown={edges.above} />
      {/* The max-height must land on the Radix viewport itself: shadcn
          hardcodes h-full on it, so a max-h on the outer ScrollArea never
          creates a scroll boundary (shadcn #296). Scroll doesn't bubble, so
          the viewport's is caught on the way down. */}
      <ScrollArea
        ref={rootRef}
        orientation="vertical"
        onScrollCapture={measure}
        className="[&>[data-slot=scroll-area-viewport]]:max-h-[60vh]"
      >
        <div className="flex flex-col gap-5 p-5">{children}</div>
      </ScrollArea>
      <ListScrollHairline shown={edges.below} edge="bottom" />
    </div>
  )
}

/**
 * The pinned footer. Anything in `notice` (an option for Save, an error) sits
 * above the buttons, below the body's lower hairline, so fields scrolled
 * under the footer end at a line rather than running into it.
 */
export function RepoDialogFooter({
  notice,
  children,
}: {
  notice?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      {notice && <div className="flex flex-col gap-3 px-5 pt-4">{notice}</div>}
      <DialogFooter className="px-5 py-4">{children}</DialogFooter>
    </div>
  )
}
