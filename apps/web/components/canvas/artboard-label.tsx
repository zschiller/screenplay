"use client"

import { Badge } from "@workspace/ui/components/badge"
import { BranchBadge } from "@/components/branch-badge"
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

export function ArtboardLabel({ label, branch, sandboxId, route, zoom, artboardWidth, dragHandlers, hmrStatus }: ArtboardLabelProps) {
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
      {branch && (
        <BranchBadge branch={branch} colorKey={sandboxId} className="text-[10px] py-0 px-1.5 mb-0.5" />
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
