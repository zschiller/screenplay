"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { NEW_CANVAS_PARAM } from "@/lib/new-canvas"
import { prewarmRoom } from "@/lib/yjs-host/client"
import { useHome } from "./home-provider"

/**
 * New canvas without a dialog (#777): create an "Untitled" Canvas, open it,
 * and let the Canvas put focus in its title so it's renamed in place.
 *
 * `create(folderId)` files the Canvas into that folder; with no argument it
 * lands in the folder you're viewing, like every other create on home. One
 * create runs at a time, so a double click or a held key makes one Canvas.
 */
export function useCreateCanvas() {
  const router = useRouter()
  const { createRoom } = useHome()
  const [creating, setCreating] = useState(false)
  const busy = useRef(false)

  const create = useCallback(
    async (folderId?: string | null) => {
      if (busy.current) return
      busy.current = true
      setCreating(true)
      try {
        const room = await createRoom("Untitled", folderId)
        // Open the connection before navigating so the new canvas renders
        // synced on its first frame rather than flashing the sync gate.
        prewarmRoom(room.id)
        router.push(`/${room.id}?${NEW_CANVAS_PARAM}=1`)
      } catch {
        toast.error("Couldn't create the canvas. Try again.")
      } finally {
        busy.current = false
        setCreating(false)
      }
    },
    [createRoom, router]
  )

  return { create, creating }
}

/**
 * Press N anywhere on home to make a new Canvas, unless you're typing or a
 * dialog or menu has focus.
 */
export function useNewCanvasShortcut(onCreate: () => void) {
  const onCreateRef = useRef(onCreate)
  useEffect(() => {
    onCreateRef.current = onCreate
  })
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (e.key.toLowerCase() !== NEW_CANVAS_SHORTCUT.toLowerCase()) return
      if (isTypingOrInOverlay(e.target)) return
      e.preventDefault()
      onCreateRef.current()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}

/** The key that makes a new Canvas from home, as its hint shows it. */
export const NEW_CANVAS_SHORTCUT = "N"

function isTypingOrInOverlay(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest("input, textarea, select")) return true
  return !!target.closest(
    '[role="dialog"], [role="alertdialog"], [role="menu"]'
  )
}
