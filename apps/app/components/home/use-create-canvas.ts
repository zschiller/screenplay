"use client"

import { useCallback, useEffect, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { prewarmRoom } from "@/lib/yjs-host/client"
import { isInOverlay, isTextEntry } from "@/lib/canvas/key-target"
import type { RoomSummary } from "@/lib/rooms-actions"

/** What the New canvas dialog creates (#1812). */
export type NewCanvasInput = {
  name: string
  /** Your Repositories to switch on as it's created. */
  repositoryIds: string[]
  /** The folder to file it into; omitted = the folder you're viewing. */
  folderId?: string | null
}

/**
 * Create a Canvas from the New canvas dialog (#1812) and open it.
 *
 * One create runs at a time, so a double click or a held Enter makes one
 * Canvas. `onError` runs when the create fails, so the dialog can say so and
 * stay open; `creating` stays on until the Canvas route renders.
 */
export function useCreateCanvas(
  createRoom: (
    name: string,
    folderId?: string | null,
    repositoryIds?: string[]
  ) => Promise<RoomSummary>
) {
  const router = useRouter()
  // The create and the navigation run as one transition, so home stays as it
  // was (the dialog's spinner up) until the Canvas route renders, then swaps
  // in one go. Updating the list first flashed the new tile, which from an
  // empty state turned the page into a grid before the Canvas opened.
  const [creating, startCreating] = useTransition()
  const busy = useRef(false)

  const create = useCallback(
    (
      { name, repositoryIds, folderId }: NewCanvasInput,
      onError: () => void
    ) => {
      if (busy.current) return
      busy.current = true
      startCreating(async () => {
        try {
          const room = await createRoom(name, folderId, repositoryIds)
          // Open the connection before navigating so the new canvas renders
          // synced on its first frame rather than flashing the sync gate.
          prewarmRoom(room.id)
          startCreating(() => router.push(`/${room.id}`))
        } catch (err) {
          console.error(err)
          onError()
        }
      })
    },
    [createRoom, router]
  )

  // Let the next create through once this one settles: it failed, or the
  // navigation was dropped (home unmounts when the Canvas opens).
  useEffect(() => {
    if (!creating) busy.current = false
  }, [creating])

  return { create, creating }
}

/**
 * Press N anywhere on home to open New canvas, unless you're typing or a
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
  return isTextEntry(target) || isInOverlay(target)
}
