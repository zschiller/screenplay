"use client"

import { useEffect, useId, useState } from "react"
import { LinkSimpleHorizontalIcon } from "@workspace/ui/components/icons"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import {
  getSharingView,
  setSharingOn,
  type SharingView,
} from "@/lib/sharing-actions"

// The Mac app's Share dialog (Sharing, #1953): the Sharing switch, which is
// one for the whole Mac, then this canvas's link and Copy link while it's on.
// The Hosted Share dialog's placement and anatomy, picked in the #1953
// exploration (option A).

type SharingDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  roomId: string
  roomName: string
}

export function SharingDialog({
  open,
  onOpenChange,
  roomId,
  roomName,
}: SharingDialogProps) {
  const switchId = useId()
  const [sharing, setSharing] = useState<SharingView | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    getSharingView(roomId)
      .then((view) => {
        if (!cancelled) setSharing(view)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, roomId])

  const handleChange = async (on: boolean) => {
    setBusy(true)
    try {
      setSharing(await setSharingOn(roomId, on))
    } catch (err) {
      setSharing((prev) => ({
        available: prev?.available ?? true,
        on: prev?.on ?? false,
        link: prev?.link ?? null,
        error: err instanceof Error ? err.message : String(err),
      }))
    } finally {
      setBusy(false)
    }
  }

  const handleCopyLink = async () => {
    if (!sharing?.link) return
    try {
      await navigator.clipboard.writeText(sharing.link)
      toast("Link copied", {
        description: "People on your tailnet can open it.",
      })
    } catch {
      toast.error("Couldn’t copy the link")
    }
  }

  const on = sharing?.on ?? false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share &ldquo;{roomName}&rdquo;</DialogTitle>
        </DialogHeader>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={switchId}>Sharing</FieldLabel>
            <FieldDescription>
              People on your tailnet can watch any canvas whose link you send.
              Turning it off stops every link.
            </FieldDescription>
          </FieldContent>
          <Switch
            id={switchId}
            checked={on}
            disabled={!sharing || busy}
            onCheckedChange={(next) => void handleChange(next)}
          />
        </Field>

        {sharing?.error && <FieldError>{sharing.error}</FieldError>}
        {sharing && !sharing.available && (
          // `tauri dev` runs `next dev`, which has no viewer listener.
          <FieldError>Sharing works only in the packaged app.</FieldError>
        )}

        {sharing?.link && (
          <Input
            readOnly
            aria-label="Link"
            value={sharing.link}
            onFocus={(e) => e.currentTarget.select()}
          />
        )}

        <DialogFooter className="sm:justify-start">
          <Button
            type="button"
            variant="outline"
            disabled={!sharing?.link}
            onClick={handleCopyLink}
          >
            <LinkSimpleHorizontalIcon />
            Copy link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
