"use client"

import { useEffect, useRef } from "react"

import { presenceInk } from "@/lib/canvas/presence-ink"

interface CursorChatProps {
  /** Screen-space position of the local cursor. */
  screenX: number
  screenY: number
  /** Cursor color used to tint the bubble. */
  color: string
  /** Current message text. */
  value: string
  onChange: (next: string) => void
  onClose: () => void
}

/**
 * Figma-style cursor chat input that anchors next to the local cursor while
 * the user is typing. Broadcasts via awareness through `onChange` so peers see
 * each keystroke next to the user's remote cursor.
 */
export function CursorChat({
  screenX,
  screenY,
  color,
  value,
  onChange,
  onClose,
}: CursorChatProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div
      className="pointer-events-none absolute z-(--z-canvas-presence)"
      style={{ left: screenX, top: screenY }}
    >
      <div
        className="pointer-events-auto mt-1 ml-3 flex items-center rounded px-2 py-1"
        style={{ backgroundColor: color }}
      >
        <input
          ref={inputRef}
          type="text"
          value={value}
          maxLength={140}
          placeholder="Say something…"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Enter") {
              e.preventDefault()
              e.stopPropagation()
              onClose()
            }
            // Stop the canvas-level keyboard shortcuts (e.g. v/c/i/t/f/Backspace)
            // from firing while the chat is open.
            e.stopPropagation()
          }}
          onBlur={onClose}
          className={
            presenceInk(color) === "dark"
              ? "w-56 bg-transparent text-sm text-black outline-none placeholder:text-black/60"
              : "w-56 bg-transparent text-sm text-white outline-none placeholder:text-white/70"
          }
        />
      </div>
    </div>
  )
}
