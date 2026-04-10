"use client"

import { X } from "lucide-react"

interface ArtboardLabelProps {
  label: string
  branch?: string
  onClose: () => void
}

export function ArtboardLabel({ label, branch, onClose }: ArtboardLabelProps) {
  return (
    <div className="absolute bottom-full left-0 mb-1 flex items-center gap-2 whitespace-nowrap">
      <span className="text-xs font-medium text-foreground/70">{label}</span>
      {branch && (
        <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {branch}
        </span>
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
