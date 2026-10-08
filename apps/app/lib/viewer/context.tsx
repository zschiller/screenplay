"use client"

import { createContext, useContext, type ReactNode } from "react"

import { EditableTextLocked } from "@workspace/ui/components/editable-text"

import { readChatsThroughLink } from "@/lib/chat-store"
import type { ViewerPerson } from "@/lib/viewer-identity/types"

/**
 * A viewer watching a canvas by its link on the viewer listener (Sharing,
 * #1932): who they are, as the viewer identity named them, and the canvas
 * link's key their Yjs socket shows. Null for the host, which is everyone on
 * the host listener.
 */
export interface Viewing {
  person: ViewerPerson
  roomId: string
  shareKey: string
}

const ViewingContext = createContext<Viewing | null>(null)

export function ViewingProvider({
  value,
  children,
}: {
  value: Viewing
  children: ReactNode
}) {
  // Before any chat below loads its history: children's effects run before
  // this component's, so the store learns the link while rendering. One
  // viewer page watches one canvas, so setting it again is a no-op.
  readChatsThroughLink({ roomId: value.roomId, shareKey: value.shareKey })
  // A viewer renames nothing (#1933): every name on the page stays a label.
  return (
    <ViewingContext value={value}>
      <EditableTextLocked value>{children}</EditableTextLocked>
    </ViewingContext>
  )
}

/** The viewer this page is for, or null on the host's own pages. */
export function useViewing(): Viewing | null {
  return useContext(ViewingContext)
}
