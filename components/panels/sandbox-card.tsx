"use client"

import { GitBranch, RefreshCw, Trash2, Loader2, Plus, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SandboxData } from "@/lib/liveblocks.types"

interface SandboxCardProps {
  sandbox: SandboxData
  onRefresh: (id: string) => void
  onRemove: (id: string) => void
  onAddArtboard: (sandboxId: string) => void
  onOpenChat: (id: string) => void
}

const statusColors: Record<SandboxData["status"], string> = {
  creating: "bg-yellow-400",
  starting: "bg-yellow-400",
  running: "bg-green-400",
  error: "bg-red-400",
  stopped: "bg-zinc-400",
}

export function SandboxCard({
  sandbox,
  onRefresh,
  onRemove,
  onAddArtboard,
  onOpenChat,
}: SandboxCardProps) {
  const isLoading =
    sandbox.status === "creating" || sandbox.status === "starting"

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${statusColors[sandbox.status]}`}
            />
            <div className="flex items-center gap-1 truncate font-mono text-xs">
              <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{sandbox.branch}</span>
            </div>
          </div>
          <p className="mt-1 truncate text-[10px] text-muted-foreground">
            {sandbox.gitUrl}
          </p>
          {sandbox.error && (
            <p className="mt-1 text-[10px] text-red-500">{sandbox.error}</p>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onOpenChat(sandbox.id)}
          disabled={sandbox.status !== "running"}
          title="AI Assistant"
        >
          <Sparkles className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onAddArtboard(sandbox.id)}
          disabled={sandbox.status !== "running"}
          title="Add artboard"
        >
          <Plus className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onRefresh(sandbox.id)}
          disabled={isLoading}
          title="Fetch latest & restart"
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(sandbox.id)}
          title="Remove sandbox"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}
