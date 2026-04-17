"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import type { RefObject } from "react"
import type { DomOp, DomRect } from "@/lib/postmessage-protocol"
import { isScreenplayMessage } from "@/lib/postmessage-protocol"

export type Handle = string

export type PickResult = {
  handle: Handle
  selector: string
  rect: DomRect
  outerHTML: string
}

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const REQUEST_TIMEOUT_MS = 5000

interface Options {
  onPicked?: (p: PickResult) => void
}

export function useScreenplayDom(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  { onPicked }: Options = {},
) {
  const pending = useRef(new Map<string, Pending>())
  const seq = useRef(0)
  const onPickedRef = useRef(onPicked)
  onPickedRef.current = onPicked

  const request = useCallback(
    <T,>(msg: {
      type: "screenplay:dom-query" | "screenplay:pick-start" | "screenplay:pick-stop"
      op?: DomOp
      selector?: string
      handle?: string
    }): Promise<T> => {
      const iframe = iframeRef.current
      if (!iframe?.contentWindow) return Promise.reject(new Error("iframe not mounted"))
      const id = "q_" + seq.current++
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending.current.delete(id)) reject(new Error("screenplay bridge timeout"))
        }, REQUEST_TIMEOUT_MS)
        pending.current.set(id, {
          resolve: resolve as (v: unknown) => void,
          reject,
          timer,
        })
        iframe.contentWindow!.postMessage({ ...msg, id }, "*")
      })
    },
    [iframeRef],
  )

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!isScreenplayMessage(e.data)) return
      const iframe = iframeRef.current
      if (!iframe?.contentWindow || e.source !== iframe.contentWindow) return

      const d = e.data
      if (d.type === "screenplay:dom-result") {
        const p = pending.current.get(d.id)
        if (!p) return
        clearTimeout(p.timer)
        pending.current.delete(d.id)
        if (d.ok) p.resolve(d.value)
        else p.reject(new Error(d.error))
      } else if (d.type === "screenplay:picked") {
        onPickedRef.current?.({
          handle: d.handle,
          selector: d.selector,
          rect: d.rect,
          outerHTML: d.outerHTML,
        })
      }
    }

    window.addEventListener("message", handleMessage)
    return () => {
      window.removeEventListener("message", handleMessage)
      for (const p of pending.current.values()) clearTimeout(p.timer)
      pending.current.clear()
    }
  }, [iframeRef])

  return useMemo(
    () => ({
      querySelector: (selector: string) =>
        request<Handle | null>({
          type: "screenplay:dom-query",
          op: "querySelector",
          selector,
        }),
      getRect: (handle: Handle) =>
        request<DomRect | null>({
          type: "screenplay:dom-query",
          op: "getRect",
          handle,
        }),
      getOuterHTML: (handle: Handle) =>
        request<string | null>({
          type: "screenplay:dom-query",
          op: "getOuterHTML",
          handle,
        }),
      startPick: () => request<null>({ type: "screenplay:pick-start" }),
      stopPick: () => request<null>({ type: "screenplay:pick-stop" }),
    }),
    [request],
  )
}
