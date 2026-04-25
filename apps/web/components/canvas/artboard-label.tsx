"use client"

import { useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { BranchBadge } from "@/components/branch-badge"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { Spinner } from "@workspace/ui/components/spinner"
import type { AgentData } from "@/lib/liveblocks.types"
import type { HmrStatus } from "@/lib/postmessage-protocol"
import { cn } from "@workspace/ui/lib/utils"

interface ArtboardLabelProps {
  label: string
  branch?: string
  sandboxId?: string
  route?: string
  zoom: number
  artboardWidth: number
  dragHandlers?: Record<string, unknown>
  hmrStatus?: HmrStatus | null
  /** Agents the user can pick from (typically all running agents in the room). */
  assignableAgents?: AgentData[]
  onAssignAgent?: (agentId: string) => void
}

const HMR_DOT_COLOR: Record<HmrStatus, string> = {
  connected: "bg-green-500",
  reconnecting: "bg-yellow-500",
  disconnected: "bg-red-500",
}

const HMR_DOT_TITLE: Record<HmrStatus, string> = {
  connected: "Dev server connected",
  reconnecting: "Reconnecting to dev server…",
  disconnected: "Dev server disconnected",
}

export function ArtboardLabel({ label, branch, sandboxId, route, zoom, artboardWidth, dragHandlers, hmrStatus, assignableAgents, onAssignAgent }: ArtboardLabelProps) {
  return (
    <div
      className="absolute bottom-full left-0 flex flex-col items-start whitespace-nowrap"
      style={{
        transform: `scale(${1 / zoom})`,
        transformOrigin: "bottom left",
        maxWidth: artboardWidth * zoom - 28,
        marginBottom: 4 / zoom,
      }}
      {...dragHandlers}
    >
      {(branch || onAssignAgent) && (
        <div className="mb-0.5">
          {onAssignAgent ? (
            <BranchPicker
              branch={branch}
              currentAgentId={sandboxId}
              colorKey={sandboxId}
              assignableAgents={assignableAgents ?? []}
              onAssignAgent={onAssignAgent}
            />
          ) : branch ? (
            <BranchBadge branch={branch} colorKey={sandboxId} className="text-[10px] py-0 px-1.5" />
          ) : null}
        </div>
      )}
      <div className="flex items-center gap-1.5 max-w-full">
        {hmrStatus && (
          <span
            title={HMR_DOT_TITLE[hmrStatus]}
            className={cn(
              "inline-block h-1.5 w-1.5 shrink-0 rounded-full ring-1 ring-white",
              HMR_DOT_COLOR[hmrStatus],
            )}
          />
        )}
        <span className="text-xs font-medium text-foreground/70 truncate min-w-0">
          {label}
        </span>
        <Badge variant="outline" className="border-transparent bg-muted font-mono text-[10px] text-foreground/50 py-0 px-1.5 shrink-0">
          {route || "/"}
        </Badge>
      </div>
    </div>
  )
}

interface BranchPickerProps {
  branch?: string
  currentAgentId?: string
  colorKey?: string
  assignableAgents: AgentData[]
  onAssignAgent: (agentId: string) => void
}

function BranchPicker({ branch, currentAgentId, colorKey, assignableAgents, onAssignAgent }: BranchPickerProps) {
  const [open, setOpen] = useState(false)
  const pickableAgents = assignableAgents.filter((a) => a.branch && a.status !== "error" && a.status !== "stopped")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {branch ? (
            <BranchBadge branch={branch} colorKey={colorKey} className="text-[10px] py-0 px-1.5" />
          ) : (
            <span className="text-xs text-muted-foreground">
              Choose a branch
            </span>
          )}
          <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" side="bottom" align="start" onPointerDown={(e) => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder="Search branches..." />
          <CommandList>
            <CommandEmpty>No branches found.</CommandEmpty>
            <CommandGroup>
              {pickableAgents.map((a) => {
                const isBusy = a.status === "creating" || a.status === "starting"
                return (
                  <CommandItem
                    key={a.id}
                    value={a.branch}
                    onSelect={() => {
                      onAssignAgent(a.id)
                      setOpen(false)
                    }}
                  >
                    <Check className={`shrink-0 ${a.id === currentAgentId ? "" : "opacity-0"}`} />
                    <BranchBadge branch={a.branch} colorKey={a.id} className="text-[11px] py-0 px-1.5" />
                    {isBusy && <Spinner className="ml-auto size-3" />}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
