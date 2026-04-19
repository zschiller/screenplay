"use client"

import { useEffect, useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  listCollaborators,
  removeCollaborator,
  shareProject,
  type CollaboratorInfo,
} from "@/lib/projects-actions"

type ShareProjectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectName: string
}

export function ShareProjectDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: ShareProjectDialogProps) {
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setCollaborators([])
      setEmail("")
      setError(null)
      return
    }
    setLoading(true)
    listCollaborators(projectId)
      .then(setCollaborators)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [open, projectId])

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const updated = await shareProject(projectId, email)
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
      const updated = await removeCollaborator(projectId, collaboratorId)
      setCollaborators(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share &ldquo;{projectName}&rdquo;</DialogTitle>
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
          <div className="text-xs font-medium text-muted-foreground">People with access</div>
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
                      <div className="truncate text-xs text-muted-foreground">{c.email}</div>
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
