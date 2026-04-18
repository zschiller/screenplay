"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { formatDistanceToNow } from "@/lib/utils"
import { Plus, Trash2, Share2, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { DeleteProjectDialog } from "@/components/delete-project-dialog"
import {
  createProject,
  deleteProject,
  listCollaborators,
  listProjects,
  removeCollaborator,
  renameProject,
  shareProject,
  type CollaboratorInfo,
  type ProjectSummary,
} from "@/lib/projects-actions"

export function ProjectsList() {
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [shareProjectId, setShareProjectId] = useState<string | null>(null)
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listProjects()
      .then((list) => {
        if (!cancelled) setProjects(list)
      })
      .catch((err) => console.error("listProjects failed", err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleCreate = async (name: string) => {
    const project = await createProject(name)
    setProjects((prev) => [project, ...prev])
    router.push(`/${project.id}`)
  }

  const handleRename = async (id: string, currentName: string) => {
    const next = prompt("Rename project", currentName)
    if (next === null) return
    const trimmed = next.trim() || "Untitled"
    await renameProject(id, trimmed)
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
    )
  }

  const shareTarget = projects.find((p) => p.id === shareProjectId) ?? null
  const deleteTarget = projects.find((p) => p.id === deleteProjectId) ?? null

  return (
    <div className="w-full max-w-xl">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Your projects</h2>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-3.5" />
          New project
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-md border border-border/60 py-8">
          <Spinner className="size-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 py-8 text-center text-sm text-muted-foreground">
          No projects yet. Create one to get started.
        </div>
      ) : (
        <ScrollArea className="max-h-[50vh]">
          <ul className="flex flex-col gap-1.5 pr-3">
            {projects.map((project) => (
              <li
                key={project.id}
                className="group flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 hover:border-border"
              >
                <button
                  onClick={() => router.push(`/${project.id}`)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-sm font-medium">{project.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatDistanceToNow(project.createdAt)}</span>
                    {!project.isOwner && <span>· Shared with you</span>}
                  </div>
                </button>
                {project.isOwner && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleRename(project.id, project.name)}
                      title="Rename"
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setShareProjectId(project.id)}
                      title="Share"
                    >
                      <Share2 className="size-3.5" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      onClick={() => setDeleteProjectId(project.id)}
                      title="Delete"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}

      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={handleCreate}
      />
      <ShareProjectDialog
        project={shareTarget}
        onOpenChange={(open) => !open && setShareProjectId(null)}
      />
      <DeleteProjectDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteProjectId(null)}
        projectName={deleteTarget?.name ?? ""}
        onConfirm={async () => {
          if (!deleteTarget) return
          await deleteProject(deleteTarget.id)
          setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id))
          setDeleteProjectId(null)
        }}
      />
    </div>
  )
}

function CreateProjectDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) setName("")
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await onCreate(name)
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Give your project a name. You can rename it later.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Untitled"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ShareProjectDialog({
  project,
  onOpenChange,
}: {
  project: ProjectSummary | null
  onOpenChange: (open: boolean) => void
}) {
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!project) {
      setCollaborators([])
      setEmail("")
      setError(null)
      return
    }
    setLoading(true)
    listCollaborators(project.id)
      .then(setCollaborators)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [project])

  if (!project) return null

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const updated = await shareProject(project.id, email)
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
      const updated = await removeCollaborator(project.id, collaboratorId)
      setCollaborators(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog open={!!project} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share &ldquo;{project.name}&rdquo;</DialogTitle>
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
