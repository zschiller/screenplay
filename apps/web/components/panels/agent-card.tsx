"use client"

import { GitFork, RefreshCw, Trash2, Loader2, Plus, Monitor } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { BranchBadge } from "@/components/branch-badge"
import type { AgentData, IframeLayerData } from "@/lib/types"

interface AgentCardProps {
  agent: AgentData
  selected: boolean
  iframeLayers: Array<Pick<IframeLayerData, "id" | "label">>
  onSelect: (id: string) => void
  onFork: (id: string) => void
  onRefresh: (id: string) => void
  onRemove: (id: string) => void
  onAddIframeLayer: (agentId: string) => void
}

const statusColors: Record<AgentData["status"], string> = {
  creating: "bg-yellow-400",
  starting: "bg-yellow-400",
  running: "bg-green-400",
  error: "bg-red-400",
  stopped: "bg-zinc-400",
}

export function AgentCard({
  agent,
  selected,
  iframeLayers,
  onSelect,
  onFork,
  onRefresh,
  onRemove,
  onAddIframeLayer,
}: AgentCardProps) {
  const isLoading =
    agent.status === "creating" || agent.status === "starting"

  return (
    <div
      className={`rounded-lg border p-2 cursor-pointer transition-colors ${
        selected
          ? "border-primary bg-primary/5"
          : "border-border bg-card hover:bg-muted/50"
      }`}
      onClick={(e) => { e.stopPropagation(); onSelect(agent.id) }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${statusColors[agent.status]}`}
          />
          {agent.branch ? (
            <BranchBadge branch={agent.branch} colorKey={agent.id} className="text-[11px] py-0 px-1.5" />
          ) : (
            <span className="truncate font-mono text-xs text-muted-foreground">creating...</span>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onAddIframeLayer(agent.id)}
            disabled={agent.status !== "running"}
            title="Add iframeLayer"
          >
            <Plus className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onFork(agent.id)}
            disabled={!agent.branch}
            title="Fork agent"
          >
            <GitFork className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onRefresh(agent.id)}
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
            onClick={() => onRemove(agent.id)}
            title="Remove agent"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {isLoading && agent.statusMessage && (
        <p className="mt-1 text-[10px] text-muted-foreground pl-4 flex items-center gap-1">
          <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" />
          {agent.statusMessage}
        </p>
      )}

      {agent.error && (
        <p className="mt-1 text-[10px] text-red-500 pl-4">{agent.error}</p>
      )}

      {iframeLayers.length > 0 && (
        <div className="mt-1.5 pl-4 space-y-0.5">
          {iframeLayers.map((ab) => (
            <div key={ab.id} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
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
