"use client"

import {
  GitFork,
  RefreshCw,
  Trash2,
  Loader2,
  Plus,
  Monitor,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { BranchBadge } from "@/components/branch-badge"
import type { BranchData, IframeLayerData } from "@/lib/types"

interface BranchCardProps {
  branch: BranchData
  selected: boolean
  iframeLayers: Array<Pick<IframeLayerData, "id" | "label">>
  onSelect: (id: string) => void
  onFork: (id: string) => void
  onRefresh: (id: string) => void
  onRemove: (id: string) => void
  onAddIframeLayer: (branchId: string) => void
}

const statusColors: Record<BranchData["status"], string> = {
  creating: "bg-yellow-400",
  starting: "bg-yellow-400",
  running: "bg-green-400",
  error: "bg-red-400",
  stopped: "bg-zinc-400",
}

export function BranchCard({
  branch,
  selected,
  iframeLayers,
  onSelect,
  onFork,
  onRefresh,
  onRemove,
  onAddIframeLayer,
}: BranchCardProps) {
  const isLoading = branch.status === "creating" || branch.status === "starting"

  return (
    <div
      className={`cursor-pointer rounded-lg border p-2 transition-colors ${
        selected
          ? "border-primary bg-primary/5"
          : "border-border bg-card hover:bg-muted/50"
      }`}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(branch.id)
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${statusColors[branch.status]}`}
          />
          {branch.ref ? (
            <BranchBadge
              branch={branch.ref}
              colorKey={branch.id}
              colorIndex={branch.colorIndex}
              className="px-1.5 py-0 text-[11px]"
            />
          ) : (
            <span className="truncate font-mono text-xs text-muted-foreground">
              creating...
            </span>
          )}
        </div>

        <div
          className="flex shrink-0 items-center gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onAddIframeLayer(branch.id)}
            disabled={branch.status !== "running"}
            title="Add iframeLayer"
          >
            <Plus className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onFork(branch.id)}
            disabled={!branch.ref}
            title="Fork branch"
          >
            <GitFork className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onRefresh(branch.id)}
            disabled={isLoading}
            title="Restart sandbox"
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
            onClick={() => onRemove(branch.id)}
            title="Remove branch"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {isLoading && branch.statusMessage && (
        <p className="mt-1 flex items-center gap-1 pl-4 text-[10px] text-muted-foreground">
          <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" />
          {branch.statusMessage}
        </p>
      )}

      {branch.error && (
        <p className="mt-1 pl-4 text-[10px] text-red-500">{branch.error}</p>
      )}

      {iframeLayers.length > 0 && (
        <div className="mt-1.5 space-y-0.5 pl-4">
          {iframeLayers.map((ab) => (
            <div
              key={ab.id}
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
            >
              <Monitor className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{ab.label}</span>
            </div>
          ))}
          <span className="text-[10px] text-muted-foreground/60">
            {iframeLayers.length} screen{iframeLayers.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}
    </div>
  )
}
