"use client"

import { Badge } from "@/components/ui/badge"
import { BranchBadge } from "@/components/branch-badge"

interface ArtboardLabelProps {
  label: string
  branch?: string
  sandboxId?: string
  route?: string
  zoom: number
  artboardWidth: number
  dragHandlers?: Record<string, unknown>
}

export function ArtboardLabel({ label, branch, sandboxId, route, zoom, artboardWidth, dragHandlers }: ArtboardLabelProps) {
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
