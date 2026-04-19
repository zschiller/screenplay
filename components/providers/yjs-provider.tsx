"use client"

import { createContext, ReactNode, useContext, useMemo } from "react"
import { useRoom } from "@liveblocks/react/suspense"
import * as Y from "yjs"
import { getYjsProviderForRoom, LiveblocksYjsProvider } from "@liveblocks/yjs"

type YjsContextValue = {
  doc: Y.Doc
  provider: LiveblocksYjsProvider
}

const YjsContext = createContext<YjsContextValue | null>(null)

export function YjsProvider({ children }: { children: ReactNode }) {
  const room = useRoom()

  const value = useMemo<YjsContextValue>(() => {
    const provider = getYjsProviderForRoom(room)
    return { doc: provider.getYDoc(), provider }
  }, [room])

  return <YjsContext.Provider value={value}>{children}</YjsContext.Provider>
}

export function useYjs(): YjsContextValue {
  const ctx = useContext(YjsContext)
  if (!ctx) throw new Error("useYjs must be used inside YjsProvider")
  return ctx
}

export function useTextFragment(layerId: string): Y.XmlFragment {
  const { doc } = useYjs()
  return useMemo(() => doc.getXmlFragment(`text-${layerId}`), [doc, layerId])
}
