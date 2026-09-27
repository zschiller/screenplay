"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { Editor } from "@tiptap/core"

import type { ScreenplayDom } from "@/hooks/use-screenplay-dom"
import type { IframeLayerLayoutMap } from "@/lib/canvas/layout"
import {
  homeFrame,
  offRouteGroups,
  placeFrameThread,
  type ElementAnchor,
  type FrameView,
  type OffRouteGroup,
  type Placement,
  type PlacementFrame,
} from "@/lib/comment-anchor"
import type { ThreadWithComments } from "@/lib/comments"
import { decodeAnchor } from "@/lib/document-comments"
import type { DomRect } from "@/lib/postmessage-protocol"
import type { IframeLayerData } from "@/lib/types"

export interface CommentPlacements {
  /** Where each open frame or document thread shows for this viewer, by
   *  thread id. Canvas-level threads (no container) aren't in it: they sit at
   *  their stored point. */
  placements: ReadonlyMap<string, Placement>
  /** Each frame's header chip: its comments on other routes, grouped. */
  offRoute: ReadonlyMap<string, OffRouteGroup[]>
}

// A pin re-renders only when it moves further than this, so sub-pixel layout
// jitter doesn't re-render the pin layer every frame.
const MOVE_EPSILON_PX = 0.5

/**
 * Places every open comment for **this viewer** (#785). Each check asks each
 * frame's bridge, in one batched call, where its comments' elements are and
 * which route the frame is on; `placeFrameThread` decides pinned, off-route or
 * detached. Positions stay in local state: nothing is written to the shared
 * canvas doc, so two viewers on different routes or scroll positions never
 * move each other's pins.
 *
 * Checks are paced by the bridge's own round-trips (the next is scheduled on
 * the animation frame after the previous batch answers), so pins follow a
 * frame's scroll without flooding the channel.
 */
export function useCommentPlacements({
  threads,
  iframeLayers,
  layouts,
  zoom,
  getIframeLayerDom,
  getDocumentEditor,
  documentEditorsVersion,
}: {
  threads: ThreadWithComments[]
  iframeLayers: IframeLayerData[]
  layouts: IframeLayerLayoutMap
  zoom: number
  getIframeLayerDom?: (id: string) => ScreenplayDom | undefined
  getDocumentEditor?: (id: string) => Editor | undefined
  documentEditorsVersion?: number
}): CommentPlacements {
  const [framePlacements, setFramePlacements] = useState<
    ReadonlyMap<string, Placement>
  >(() => new Map())
  const [docPlacements, setDocPlacements] = useState<
    ReadonlyMap<string, Placement>
  >(() => new Map())

  const frames = useMemo(() => {
    const m = new Map<string, PlacementFrame>()
    for (const layer of iframeLayers) {
      const layout = layouts.get(layer.id)
      if (!layout) continue
      m.set(layer.id, {
        id: layer.id,
        branchId: layer.branchId,
        width: layout.width,
        height: layout.height,
      })
    }
    return m
  }, [iframeLayers, layouts])
  // The route each frame shows in the shared doc: the fallback for an older
  // bridge that can't report its own.
  const sharedRoutes = useMemo(
    () => new Map(iframeLayers.map((l) => [l.id, l.route ?? "/"])),
    [iframeLayers]
  )

  const frameThreads = useMemo(
    () => threads.filter((t) => !t.resolved && t.iframeLayerId),
    [threads]
  )

  // When each thread's element was first reported missing on its route.
  const missingSinceRef = useRef(new Map<string, number>())

  useEffect(() => {
    let cancelled = false
    let rafId: number | null = null
    const missingSince = missingSinceRef.current

    // Group threads by the frame they belong on this check.
    function group() {
      const byFrame = new Map<string, ThreadWithComments[]>()
      for (const t of frameThreads) {
        const frame = homeFrame(t, frames)
        if (!frame) continue
        const arr = byFrame.get(frame.id)
        if (arr) arr.push(t)
        else byFrame.set(frame.id, [t])
      }
      return byFrame
    }

    async function viewsFor(
      frameId: string,
      group: ThreadWithComments[]
    ): Promise<Map<string, FrameView> | null> {
      const dom = getIframeLayerDom?.(frameId)
      if (!dom) return null
      const anchors: ElementAnchor[] = group.map(
        (t) => t.anchor ?? { path: t.selector ?? "" }
      )
      let path: string
      let rects: (DomRect | null)[]
      try {
        ;({ path, rects } = await dom.resolveAnchors(anchors))
      } catch (e) {
        // An older bridge has no `resolveAnchors`: fall back to plain paths
        // and the frame's shared route.
        if (!String(e).includes("unknown op")) return null
        try {
          rects = await dom.getRectsForSelectors(anchors.map((a) => a.path))
        } catch {
          return null
        }
        path = sharedRoutes.get(frameId) ?? "/"
      }
      const views = new Map<string, FrameView>()
      group.forEach((t, i) => views.set(t.id, { path, rect: rects[i] ?? null }))
      return views
    }

    async function tick() {
      const byFrame = group()
      const results = await Promise.all(
        Array.from(byFrame, async ([frameId, group]) => ({
          frameId,
          views: await viewsFor(frameId, group),
        }))
      )
      if (cancelled) return
      const views = new Map<string, FrameView>()
      for (const r of results) {
        if (r.views) for (const [id, v] of r.views) views.set(id, v)
      }
      const now = Date.now()
      const next = new Map<string, Placement>()
      for (const t of frameThreads) {
        const view = views.get(t.id) ?? null
        if (view && !view.rect) {
          if (!missingSince.has(t.id)) missingSince.set(t.id, now)
        } else if (view) {
          missingSince.delete(t.id)
        }
        next.set(
          t.id,
          placeFrameThread({
            thread: t,
            frame: homeFrame(t, frames),
            view,
            missingSince: missingSince.get(t.id) ?? null,
            now,
          })
        )
      }
      setFramePlacements((prev) => (samePlacements(prev, next) ? prev : next))
    }

    function loop() {
      if (cancelled) return
      tick().finally(() => {
        if (cancelled) return
        rafId = requestAnimationFrame(loop)
      })
    }
    if (frameThreads.length > 0) loop()
    return () => {
      cancelled = true
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [frameThreads, frames, sharedRoutes, getIframeLayerDom])

  // Document threads: pinned in the doc tile's right margin, level with the
  // start of their highlighted range. A range that no longer resolves, or a
  // doc that's gone, is detached.
  useEffect(() => {
    // Measured on the next frame, once the doc tiles have laid out.
    const raf = requestAnimationFrame(() =>
      setDocPlacements((prev) => {
        const next = placeDocThreads()
        return samePlacements(prev, next) ? prev : next
      })
    )
    return () => cancelAnimationFrame(raf)

    function placeDocThreads() {
      const next = new Map<string, Placement>()
      for (const t of threads) {
        if (t.resolved || !t.documentId || !t.anchorStart || !t.anchorEnd) {
          continue
        }
        const layout = layouts.get(t.documentId)
        if (!layout) {
          next.set(t.id, { kind: "detached", reason: "frame" })
          continue
        }
        const editor = getDocumentEditor?.(t.documentId)
        if (!editor || editor.isDestroyed) {
          next.set(t.id, { kind: "pending" })
          continue
        }
        const from = decodeAnchor(editor, t.anchorStart)
        const to = decodeAnchor(editor, t.anchorEnd)
        if (from === null || to === null || from >= to) {
          next.set(t.id, { kind: "detached", reason: "element" })
          continue
        }
        const layerEl = editor.view.dom.closest(
          "[data-doc-id]"
        ) as HTMLElement | null
        const layerRect = layerEl?.getBoundingClientRect()
        if (!layerRect) {
          next.set(t.id, { kind: "pending" })
          continue
        }
        const top = editor.view.coordsAtPos(from).top
        next.set(t.id, {
          kind: "pinned",
          frameId: t.documentId,
          x: layout.width,
          y: (top - layerRect.top) / zoom,
        })
      }
      return next
    }
    // `documentEditorsVersion` re-runs this when an editor (un)registers.
  }, [threads, layouts, zoom, getDocumentEditor, documentEditorsVersion])

  return useMemo(() => {
    // The last check may still hold threads resolved or deleted since.
    const live = new Set(frameThreads.map((t) => t.id))
    const frame = new Map(
      Array.from(framePlacements).filter(([id]) => live.has(id))
    )
    return {
      placements: new Map([...frame, ...docPlacements]),
      offRoute: offRouteGroups(frame.values()),
    }
  }, [frameThreads, framePlacements, docPlacements])
}

function samePlacements(
  a: ReadonlyMap<string, Placement>,
  b: ReadonlyMap<string, Placement>
): boolean {
  if (a.size !== b.size) return false
  for (const [id, pb] of b) {
    const pa = a.get(id)
    if (!pa || pa.kind !== pb.kind) return false
    if (pa.kind === "pinned" && pb.kind === "pinned") {
      if (
        pa.frameId !== pb.frameId ||
        Math.abs(pa.x - pb.x) > MOVE_EPSILON_PX ||
        Math.abs(pa.y - pb.y) > MOVE_EPSILON_PX
      ) {
        return false
      }
    } else if (pa.kind === "offRoute" && pb.kind === "offRoute") {
      if (pa.frameId !== pb.frameId || pa.route !== pb.route) return false
    } else if (pa.kind === "detached" && pb.kind === "detached") {
      if (pa.reason !== pb.reason) return false
    }
  }
  return true
}
