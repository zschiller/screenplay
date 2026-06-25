"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type * as Y from "yjs"

import { documentFragment } from "@/lib/yjs/fragment-text"

/**
 * The set of client ids touched by an awareness `update`. Both
 * `y-protocols/awareness` and `@liveblocks/yjs` pass this as the first handler
 * argument; consumers use it to ignore updates that can't affect them (e.g. our
 * own per-frame viewport broadcast while panning). It's optional on the handler
 * so backends that don't supply it degrade to "every update is relevant".
 */
export type AwarenessChange = {
  added: number[]
  updated: number[]
  removed: number[]
}

/**
 * Structural shape that any Yjs awareness implementation must satisfy.
 * Both `y-protocols/awareness.Awareness` and `@liveblocks/yjs`'s built-in
 * Awareness wrapper match it without explicit conformance.
 */
export type AwarenessLike = {
  getLocalState(): unknown
  setLocalState(state: unknown): void
  getStates(): Map<number, unknown>
  on(
    event: "change" | "update",
    handler: (changes?: AwarenessChange) => void
  ): void
  off(
    event: "change" | "update",
    handler: (changes?: AwarenessChange) => void
  ): void
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
  /** The room this connection is bound to. Lets in-room hooks address
   *  server actions (e.g. the branch-git refresh) at their own room without
   *  prop-drilling the id down from the page. */
  roomId: string
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

/** The current room id, from the active Yjs connection. */
export function useRoomId(): string {
  return useYjs().roomId
}

/**
 * Y.XmlFragment for a document layer's body. Owned by the TipTap editor
 * inside `MarkdownLayer` and synced via the room's Yjs doc.
 */
export function useDocumentFragment(layerId: string): Y.XmlFragment {
  const { doc } = useYjs()
  return useMemo(() => documentFragment(doc, layerId), [doc, layerId])
}
