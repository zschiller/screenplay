"use client"

import { createContext, useContext, type ReactNode } from "react"

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
  return <ViewingContext value={value}>{children}</ViewingContext>
}

/** The viewer this page is for, or null on the host's own pages. */
export function useViewing(): Viewing | null {
  return useContext(ViewingContext)
}
