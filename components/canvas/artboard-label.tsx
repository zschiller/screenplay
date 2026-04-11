"use client"

import { X } from "lucide-react"
import { BranchBadge } from "@/components/branch-badge"

interface ArtboardLabelProps {
  label: string
  branch?: string
  sandboxId?: string
  onClose: () => void
}

export function ArtboardLabel({ label, branch, sandboxId, onClose }: ArtboardLabelProps) {
  return (
    <div className="absolute bottom-full left-0 mb-1 flex items-center gap-2 whitespace-nowrap">
      <span className="text-xs font-medium text-foreground/70">{label}</span>
      {branch && (
        <BranchBadge branch={branch} colorKey={sandboxId} className="text-[10px] py-0 px-1.5" />
      )}
      <button
        onClick={onClose}
        className="flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
