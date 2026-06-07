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

export type WheelForward = {
  deltaX: number
  deltaY: number
  ctrlKey: boolean
  metaKey: boolean
  clientX: number
  clientY: number
}

interface Options {
  onPicked?: (p: PickResult) => void
  onHover?: (rect: DomRect | null) => void
  onWheel?: (e: WheelForward) => void
  onPanStart?: () => void
  onPanDelta?: (dx: number, dy: number) => void
  onPanEnd?: () => void
  onSpaceDown?: () => void
  onSpaceUp?: () => void
}

export type ScreenplayDom = ReturnType<typeof useScreenplayDom>

export function useScreenplayDom(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  {
    onPicked,
    onHover,
    onWheel,
    onPanStart,
    onPanDelta,
    onPanEnd,
    onSpaceDown,
    onSpaceUp,
  }: Options = {}
) {
  const pending = useRef(new Map<string, Pending>())
  const seq = useRef(0)
  const onPickedRef = useRef(onPicked)
  const onHoverRef = useRef(onHover)
  const onWheelRef = useRef(onWheel)
  const onPanStartRef = useRef(onPanStart)
  const onPanDeltaRef = useRef(onPanDelta)
  const onPanEndRef = useRef(onPanEnd)
  const onSpaceDownRef = useRef(onSpaceDown)
  const onSpaceUpRef = useRef(onSpaceUp)

  // Keep the latest callbacks in refs (written after commit, not during
  // render) so the long-lived message/key listeners below can read them
  // without re-subscribing on every render.
  useEffect(() => {
    onPickedRef.current = onPicked
    onHoverRef.current = onHover
    onWheelRef.current = onWheel
    onPanStartRef.current = onPanStart
    onPanDeltaRef.current = onPanDelta
    onPanEndRef.current = onPanEnd
    onSpaceDownRef.current = onSpaceDown
    onSpaceUpRef.current = onSpaceUp
  })

  const request = useCallback(
    <T>(msg: {
      type:
        | "screenplay:dom-query"
        | "screenplay:pick-start"
        | "screenplay:pick-stop"
        | "screenplay:set-forward-input"
      op?: DomOp
      selector?: string
      selectors?: string[]
      handle?: string
      enabled?: boolean
      x?: number
      y?: number
    }): Promise<T> => {
      const iframe = iframeRef.current
      if (!iframe?.contentWindow)
        return Promise.reject(new Error("iframe not mounted"))
      const id = "q_" + seq.current++
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending.current.delete(id))
            reject(new Error("screenplay bridge timeout"))
        }, REQUEST_TIMEOUT_MS)
        pending.current.set(id, {
          resolve: resolve as (v: unknown) => void,
          reject,
          timer,
        })
        iframe.contentWindow!.postMessage({ ...msg, id }, "*")
      })
    },
    [iframeRef]
  )

  useEffect(() => {
    // `pending` is a ref to a Map created once and only ever mutated, so its
    // identity is stable for the effect's lifetime. Capture it in a local so
    // the cleanup operates on the same Map the listener used (and to satisfy
    // the ref-in-cleanup lint).
    const pendingRequests = pending.current
    function handleMessage(e: MessageEvent) {
      if (!isScreenplayMessage(e.data)) return
      const iframe = iframeRef.current
      if (!iframe?.contentWindow || e.source !== iframe.contentWindow) return

      const d = e.data
      if (d.type === "screenplay:dom-result") {
        const p = pendingRequests.get(d.id)
        if (!p) return
        clearTimeout(p.timer)
        pendingRequests.delete(d.id)
        if (d.ok) p.resolve(d.value)
        else p.reject(new Error(d.error))
      } else if (d.type === "screenplay:picked") {
        onPickedRef.current?.({
          handle: d.handle,
          selector: d.selector,
          rect: d.rect,
          outerHTML: d.outerHTML,
        })
      } else if (d.type === "screenplay:hover") {
        onHoverRef.current?.(d.rect)
      } else if (d.type === "screenplay:wheel") {
        onWheelRef.current?.({
          deltaX: d.deltaX,
          deltaY: d.deltaY,
          ctrlKey: d.ctrlKey,
          metaKey: d.metaKey,
          clientX: d.clientX,
          clientY: d.clientY,
        })
      } else if (d.type === "screenplay:pan-start") {
        onPanStartRef.current?.()
      } else if (d.type === "screenplay:pan-delta") {
        onPanDeltaRef.current?.(d.dx, d.dy)
      } else if (d.type === "screenplay:pan-end") {
        onPanEndRef.current?.()
      } else if (d.type === "screenplay:space-down") {
        onSpaceDownRef.current?.()
      } else if (d.type === "screenplay:space-up") {
        onSpaceUpRef.current?.()
      }
    }

    window.addEventListener("message", handleMessage)
    return () => {
      window.removeEventListener("message", handleMessage)
      for (const p of pendingRequests.values()) clearTimeout(p.timer)
      pendingRequests.clear()
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
      elementAtPoint: (x: number, y: number) =>
        request<PickResult | null>({
          type: "screenplay:dom-query",
          op: "elementAtPoint",
          x,
          y,
        }),
      getRectsForSelectors: (selectors: string[]) =>
        request<(DomRect | null)[]>({
          type: "screenplay:dom-query",
          op: "getRectsForSelectors",
          selectors,
        }),
      getDocumentSize: () =>
        request<{ width: number; height: number } | null>({
          type: "screenplay:dom-query",
          op: "getDocumentSize",
        }),
      startPick: () => request<null>({ type: "screenplay:pick-start" }),
      stopPick: () => request<null>({ type: "screenplay:pick-stop" }),
      setForwardInput: (enabled: boolean) =>
        request<null>({ type: "screenplay:set-forward-input", enabled }),
    }),
    [request]
  )
}
