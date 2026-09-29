"use client"

import { useEffect, useState } from "react"
import { LinkSimpleHorizontalIcon } from "@workspace/ui/components/icons"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { withBasePath } from "@/lib/base-path"
import {
  listCollaborators,
  removeCollaborator,
  shareRoom,
  type CollaboratorInfo,
} from "@/lib/rooms-actions"

// The Share dialog on the shared dialog anatomy (issue #808): an invite form,
// the people with access, and Copy link in the footer. An invite confirms with
// a toast naming who was added; removing someone asks first.

type ShareRoomDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  roomId: string
  roomName: string
}

export function ShareRoomDialog({
  open,
  onOpenChange,
  roomId,
  roomName,
}: ShareRoomDialogProps) {
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The collaborator whose removal is being confirmed, if any.
  const [removing, setRemoving] = useState<CollaboratorInfo | null>(null)

  // Reset transient state when the dialog is dismissed, so reopening starts
  // clean. Done during render via the previous-prop pattern rather than in an
  // effect (see react.dev "You Might Not Need an Effect").
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      // Entering the loading state here (rather than synchronously inside the
      // fetch effect) keeps the effect free of synchronous setState calls.
      setLoading(true)
    } else {
      setCollaborators([])
      setEmail("")
      setError(null)
      setRemoving(null)
    }
  }

  useEffect(() => {
    if (!open) return
    listCollaborators(roomId)
      .then(setCollaborators)
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      )
      .finally(() => setLoading(false))
  }, [open, roomId])

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const updated = await shareRoom(roomId, email)
      const invited = email.trim().toLowerCase()
      const added = updated.find((c) => c.email?.toLowerCase() === invited)
      setCollaborators(updated)
      setEmail("")
      toast(`Invited ${added?.name ?? invited}`, {
        description: `They can now open “${roomName}”.`,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  // Runs from the confirm, which shows a failure inline and stays open.
  const handleRemove = async (collaboratorId: string) => {
    const updated = await removeCollaborator(roomId, collaboratorId)
    setCollaborators(updated)
    setRemoving(null)
  }

  const handleCopyLink = async () => {
    const url = `${window.location.origin}${withBasePath(`/${roomId}`)}`
    try {
      await navigator.clipboard.writeText(url)
      toast("Link copied", {
        description: "Only people with access can open it.",
      })
    } catch {
      toast.error("Couldn't copy the link")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share &ldquo;{roomName}&rdquo;</DialogTitle>
          <DialogDescription>
            Invite collaborators by their Screenplay account email.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleShare} className="flex gap-2">
          <Input
            type="email"
            required
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" disabled={submitting}>
            {submitting ? "Adding…" : "Invite"}
          </Button>
        </form>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-col gap-2">
          <div className="font-mono text-2xs font-normal tracking-wider text-muted-foreground uppercase">
            People with access
          </div>
          {loading ? (
            <div className="flex items-center gap-2 py-2">
              <Spinner className="size-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading…</span>
            </div>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {collaborators.map((c) => (
                <li
                  key={c.userId}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm">{c.name}</div>
                    {c.email && (
                      <div className="truncate text-xs text-muted-foreground">
                        {c.email}
                      </div>
                    )}
                  </div>
                  {c.isOwner ? (
                    <span className="text-xs text-muted-foreground">Owner</span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      // Pull the label flush with the owner row's "Owner".
                      className="-mr-2.5 text-muted-foreground"
                      aria-label={`Remove ${c.name}`}
                      onClick={() => setRemoving(c)}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="sm:justify-start">
          <Button type="button" variant="outline" onClick={handleCopyLink}>
            <LinkSimpleHorizontalIcon />
            Copy link
          </Button>
        </DialogFooter>
      </DialogContent>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next) setRemoving(null)
        }}
        verb="Remove"
        itemName={removing?.name}
        itemNoun="collaborator"
        description={`They'll lose access to “${roomName}”. You can invite them again later.`}
        onConfirm={() => (removing ? handleRemove(removing.userId) : undefined)}
      />
    </Dialog>
  )
}
