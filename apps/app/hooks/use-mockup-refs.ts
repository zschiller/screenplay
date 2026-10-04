"use client"

import { useEffect, useMemo, useState } from "react"
import type { MockupRefsResponse } from "@/app/api/mockup-refs/[roomId]/route"
import { withBasePath } from "@/lib/base-path"
import { useRoomId } from "@/lib/yjs/context"
import {
  MAX_MOCKUP_REFS,
  mockupRefs,
  type MockupResources,
} from "@/lib/mockup-refs"

const NONE: MockupResources = {}

// Resolved references by room, Mockup and reference list, for the session:
// a page that keeps its references re-renders without asking again.
const cache = new Map<string, Promise<MockupResources>>()

/**
 * The `skill:` and `files:` references (#1643) a Mockup's page names,
 * resolved through the members-only route, for `mockupSrcDoc`; null while
 * they load. A page with none needs nothing and gets an empty set at once. A
 * reference that doesn't resolve stays out of the set (the page gets an
 * empty resource), and the canvas logs which.
 */
export function useMockupRefs(
  mockupId: string,
  html: string
): MockupResources | null {
  const roomId = useRoomId()
  const refs = useMemo(() => mockupRefs(html), [html])
  const key = refs.length ? `${roomId}\n${mockupId}\n${refs.join("\n")}` : ""
  const [loaded, setLoaded] = useState<{
    key: string
    resources: MockupResources
  } | null>(null)

  useEffect(() => {
    if (!key) return
    let promise = cache.get(key)
    if (!promise) {
      promise = fetchRefs(roomId, mockupId, refs)
      cache.set(key, promise)
      void promise.then((resources) => {
        const missing = refs.filter((ref) => !resources[ref])
        for (const ref of missing) {
          console.warn(`Mockup ${mockupId}: couldn’t resolve ${ref}`)
        }
        // A file that turns up later shows once the page changes or opens
        // again.
        if (missing.length) cache.delete(key)
      })
    }
    let live = true
    void promise.then((resources) => {
      if (live) setLoaded({ key, resources })
    })
    return () => {
      live = false
    }
  }, [key, roomId, mockupId, refs])

  if (!key) return NONE
  return loaded?.key === key ? loaded.resources : null
}

async function fetchRefs(
  roomId: string,
  mockupId: string,
  refs: readonly string[]
): Promise<MockupResources> {
  try {
    const res = await fetch(
      withBasePath(`/api/mockup-refs/${encodeURIComponent(roomId)}`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mockupId,
          refs: refs.slice(0, MAX_MOCKUP_REFS),
        }),
      }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return ((await res.json()) as MockupRefsResponse).resources
  } catch {
    // The page still shows, with its references empty.
    return NONE
  }
}
