"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd"

import { isLocalBuild } from "@/lib/local-mode"
import { canvasShortcutGroups } from "@/lib/canvas/shortcuts"

/**
 * The `?` keyboard shortcut sheet (#734): every canvas shortcut, grouped, read
 * from the one catalogue in `lib/canvas/shortcuts` so it lists what the
 * keyboard controller actually handles.
 */
export function ShortcutSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const groups = canvasShortcutGroups({ comments: !isLocalBuild })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl"
        // A read-only sheet: don't park a focus ring on the close button.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts that work on the canvas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {groups.map((group) => (
            <section key={group.title} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">
                {group.title}
              </h3>
              <dl className="flex flex-col gap-1">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.label}
                    className="flex items-center justify-between gap-4"
                  >
                    <dt>{shortcut.label}</dt>
                    <dd className="flex items-center gap-1.5">
                      {shortcut.keys.length > 0 && (
                        <KbdGroup>
                          {shortcut.keys.map((key) => (
                            <Kbd key={key}>{key}</Kbd>
                          ))}
                        </KbdGroup>
                      )}
                      {shortcut.gesture && (
                        <span className="text-xs text-muted-foreground">
                          {shortcut.gesture}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
