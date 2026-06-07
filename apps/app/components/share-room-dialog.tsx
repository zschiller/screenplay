"use client"

import { useEffect, useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  listCollaborators,
  removeCollaborator,
  shareRoom,
  type CollaboratorInfo,
} from "@/lib/rooms-actions"

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
      setCollaborators(updated)
      setEmail("")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const handleRemove = async (collaboratorId: string) => {
    setError(null)
    try {
      const updated = await removeCollaborator(roomId, collaboratorId)
      setCollaborators(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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

        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium text-muted-foreground">
            People with access
          </div>
          {loading ? (
            <div className="flex items-center gap-2 py-2">
              <Spinner className="size-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading…</span>
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {collaborators.map((c) => (
                <li
                  key={c.userId}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
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
                      size="icon-sm"
                      onClick={() => handleRemove(c.userId)}
                      title="Remove"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
