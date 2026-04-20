"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowUp, X } from "lucide-react"
import { Button } from "@/components/ui/button"

interface InspectComposerProps {
  selector: string
  onSubmit: (note: string) => void
  onCancel: () => void
}

export function InspectComposer({ selector, onSubmit, onCancel }: InspectComposerProps) {
  const [note, setNote] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = note.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }, [note, onSubmit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      } else if (e.key === "Escape") {
        e.preventDefault()
        onCancel()
      }
    },
    [handleSubmit, onCancel],
  )

  return (
    <>
      <div className="mb-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
        <span className="truncate font-mono" title={selector}>{selector}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto h-4 w-4 shrink-0"
          onClick={onCancel}
          title="Cancel"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <textarea
        ref={textareaRef}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Notes about this element..."
        rows={2}
        className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="mt-1.5 flex items-center justify-end">
        <Button
          variant="default"
          size="icon-xs"
          onClick={handleSubmit}
          disabled={!note.trim()}
          title="Send to chat (Enter)"
        >
          <ArrowUp className="h-3 w-3" />
        </Button>
      </div>
    </>
  )
}
