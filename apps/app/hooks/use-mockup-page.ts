"use client"

import { useEffect, useState } from "react"
import { withBasePath } from "@/lib/base-path"
import { mockupHasPage, type MockupPageResponse } from "@/lib/mockup-folder"
import type { MockupLayerData } from "@/lib/types"
import { useRoomId } from "@/lib/yjs/context"
import { useMockupHtml } from "@/lib/yjs/react"

/** A Mockup's page as a view renders it. */
export type MockupPage = {
  /** `index.html`; "" for a Mockup with no page yet. */
  html: string
  /** The absolute URL its relative paths load from, when it has a folder. */
  base?: string
}

const NO_PAGE: MockupPage = { html: "" }

export type MockupPageState = {
  /**
   * The page, or the one shown before while a newer revision loads; null
   * until the first one arrives.
   */
  page: MockupPage | null
  /** Whether the Mockup has a page, known from its record before it loads. */
  hasPage: boolean
  /** Whether `page` is the current revision's. */
  current: boolean
}

// Fetched pages by room, file and revision, for the session: every view of
// one Mockup shares one fetch.
const cache = new Map<string, Promise<MockupPageResponse | null>>()

/** Refetch this long before a page's base stops working. */
const RENEW_BEFORE_MS = 60 * 60 * 1000

/**
 * A Mockup's page (#1886): its folder's `index.html`, fetched through the
 * members-only folder route, and the base its relative paths load from
 * (`lib/mockup-folder`). It refetches when the folder's revision changes, so
 * every view reloads on a write, and before the base's token runs out,
 * keeping the page it had until the new one arrives. A Mockup with no page
 * gets an empty one at once.
 */
export function useMockupPage(
  layer: Pick<MockupLayerData, "id" | "fileId" | "revision" | "copyOf">
): MockupPageState {
  const roomId = useRoomId()
  const fileId = layer.fileId ?? layer.id
  // A page from before folders still in the room doc: the server moves it
  // into the folder on the first read, which empties this.
  const legacy = useMockupHtml(fileId)
  const hasPage = mockupHasPage(layer, legacy)
  const [renewal, setRenewal] = useState(0)
  const key = hasPage
    ? [
        roomId,
        fileId,
        layer.revision ?? 0,
        layer.copyOf ?? "",
        legacy.length,
        renewal,
      ].join("\n")
    : ""
  const [loaded, setLoaded] = useState<{
    key: string
    page: MockupPage
  } | null>(null)

  useEffect(() => {
    if (!key) return
    let promise = cache.get(key)
    if (!promise) {
      promise = fetchPage(roomId, fileId)
      cache.set(key, promise)
      // A failed fetch tries again next time the page changes or opens.
      void promise.then((res) => {
        if (!res) cache.delete(key)
      })
    }
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    void promise.then((res) => {
      if (!live) return
      setLoaded({
        key,
        page: res
          ? {
              html: res.html,
              base: new URL(res.base, window.location.origin).href,
            }
          : NO_PAGE,
      })
      if (res) {
        const wait = Math.max(0, res.expiresAt - RENEW_BEFORE_MS - Date.now())
        timer = setTimeout(() => {
          cache.delete(key)
          setRenewal((n) => n + 1)
        }, wait)
      }
    })
    return () => {
      live = false
      if (timer) clearTimeout(timer)
    }
  }, [key, roomId, fileId])

  if (!key) return { page: NO_PAGE, hasPage, current: true }
  const current = loaded?.key === key
  // Another Mockup's page is never this one's.
  const same = loaded?.key.split("\n", 2).join("\n") === `${roomId}\n${fileId}`
  return { page: same ? loaded!.page : null, hasPage, current }
}

async function fetchPage(
  roomId: string,
  fileId: string
): Promise<MockupPageResponse | null> {
  try {
    const res = await fetch(
      withBasePath(
        `/api/mockup-folders/${encodeURIComponent(roomId)}/${encodeURIComponent(fileId)}`
      )
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as MockupPageResponse
  } catch (e) {
    console.warn(`Mockup ${fileId}: couldn’t load its page`, e)
    return null
  }
}
