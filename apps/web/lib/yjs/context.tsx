"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type * as Y from "yjs"

/**
 * Structural shape that any Yjs awareness implementation must satisfy.
 * Both `y-protocols/awareness.Awareness` and `@liveblocks/yjs`'s built-in
 * Awareness wrapper match it without explicit conformance.
 */
export type AwarenessLike = {
  getLocalState(): unknown
  setLocalState(state: unknown): void
  getStates(): Map<number, unknown>
  on(event: "change" | "update", handler: () => void): void
  off(event: "change" | "update", handler: () => void): void
  doc: Y.Doc
}

/**
 * The host-agnostic value exposed to consumers via `useYjs()`. Hosts publish
 * a `{ doc, awareness }` once they've connected to a room and the initial
 * sync has completed.
 */
export type YjsConnection = {
  doc: Y.Doc
  awareness: AwarenessLike
}

const YjsContext = createContext<YjsConnection | null>(null)

export function YjsConnectionProvider({
  value,
  children,
}: {
  value: YjsConnection
  children: ReactNode
}) {
  return <YjsContext.Provider value={value}>{children}</YjsContext.Provider>
}

export function useYjs(): YjsConnection {
  const ctx = useContext(YjsContext)
  if (!ctx) throw new Error("useYjs must be used inside a YjsRoomProvider")
  return ctx
}

/**
 * Y.XmlFragment for a document layer's body. Owned by the TipTap editor
 * inside `MarkdownLayer` and synced via the room's Yjs doc.
 */
export function useDocumentFragment(layerId: string): Y.XmlFragment {
  const { doc } = useYjs()
  return useMemo(() => doc.getXmlFragment(`markdown-layer-${layerId}`), [doc, layerId])
}
