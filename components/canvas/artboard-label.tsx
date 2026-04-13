"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import { BranchBadge } from "@/components/branch-badge"

interface ArtboardLabelProps {
  label: string
  branch?: string
  sandboxId?: string
  route?: string
  onRename: (label: string) => void
}

export function ArtboardLabel({ label, branch, sandboxId, route, onRename }: ArtboardLabelProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.select()
    }
  }, [editing])

  const commit = useCallback(() => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== label) {
      onRename(trimmed)
    } else {
      setDraft(label)
    }
    setEditing(false)
  }, [draft, label, onRename])

  return (
    <div className="absolute bottom-full left-0 mb-1 flex flex-col items-start whitespace-nowrap">
      {branch && (
        <BranchBadge branch={branch} colorKey={sandboxId} className="text-[10px] py-0 px-1.5 mb-0.5" />
      )}
      <div className="flex items-center gap-1.5">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit()
              if (e.key === "Escape") {
                setDraft(label)
                setEditing(false)
              }
            }}
            className="text-xs font-medium text-foreground/70 bg-transparent border-b border-foreground/30 outline-none px-0 py-0 w-auto min-w-[3ch]"
            style={{ width: `${Math.max(draft.length, 3)}ch` }}
          />
        ) : (
          <span
            className="text-xs font-medium text-foreground/70 cursor-text"
            onDoubleClick={() => {
              setDraft(label)
              setEditing(true)
            }}
          >
            {label}
          </span>
        )}
        <Badge variant="outline" className="border-transparent bg-muted font-mono text-[10px] text-foreground/50 py-0 px-1.5">
          {route || "/"}
        </Badge>
      </div>
    </div>
  )
}
