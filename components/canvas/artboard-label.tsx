"use client"

import { Badge } from "@/components/ui/badge"
import { BranchBadge } from "@/components/branch-badge"

interface ArtboardLabelProps {
  label: string
  branch?: string
  sandboxId?: string
  route?: string
  dragHandlers?: Record<string, unknown>
}

export function ArtboardLabel({ label, branch, sandboxId, route, dragHandlers }: ArtboardLabelProps) {
  return (
    <div className="absolute bottom-full left-0 mb-1 flex flex-col items-start whitespace-nowrap" {...dragHandlers}>
      {branch && (
        <BranchBadge branch={branch} colorKey={sandboxId} className="text-[10px] py-0 px-1.5 mb-0.5" />
      )}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-foreground/70">
          {label}
        </span>
        <Badge variant="outline" className="border-transparent bg-muted font-mono text-[10px] text-foreground/50 py-0 px-1.5">
          {route || "/"}
        </Badge>
      </div>
    </div>
  )
}
