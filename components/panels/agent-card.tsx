"use client"

import { GitFork, RefreshCw, Trash2, Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BranchBadge } from "@/components/branch-badge"
import type { AgentData } from "@/lib/liveblocks.types"

interface AgentCardProps {
  agent: AgentData
  selected: boolean
  onSelect: (id: string) => void
  onFork: (id: string) => void
  onRefresh: (id: string) => void
  onRemove: (id: string) => void
  onAddArtboard: (agentId: string) => void
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
  onSelect,
  onFork,
  onRefresh,
  onRemove,
  onAddArtboard,
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
            <BranchBadge branch={agent.branch} icon className="text-[11px] py-0 px-1.5" />
          ) : (
            <span className="truncate font-mono text-xs text-muted-foreground">creating...</span>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onAddArtboard(agent.id)}
            disabled={agent.status !== "running"}
            title="Add artboard"
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
    </div>
  )
}
