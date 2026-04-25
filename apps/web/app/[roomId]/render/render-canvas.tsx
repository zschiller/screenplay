"use client"

import { useEffect, useState } from "react"

export type RenderArtboard = {
  id: string
  x: number
  y: number
  width: number
  height: number
  label: string
  iframeUrl: string | null
}

export type RenderTextLayer = {
  id: string
  x: number
  y: number
  width: number
  html: string
  text: string
}

const VIEWPORT_W = 1280
const VIEWPORT_H = 960
const PADDING = 80
const MAX_SCALE = 1
// prose-sm: 14px font with ~1.71 line-height, plus paragraph spacing.
const TEXT_FONT_SIZE = 14
const TEXT_LINE_HEIGHT = 1.7142857
const READY_TIMEOUT_MS = 8_000

function estimateTextHeight(text: string, width: number): number {
  if (!text) return TEXT_FONT_SIZE * TEXT_LINE_HEIGHT
  const charsPerLine = Math.max(1, Math.floor(width / (TEXT_FONT_SIZE * 0.55)))
  let lines = 0
  for (const para of text.split("\n")) {
    lines += Math.max(1, Math.ceil(para.length / charsPerLine))
  }
  return Math.ceil(lines * TEXT_FONT_SIZE * TEXT_LINE_HEIGHT)
}

declare global {
  interface Window {
    __thumbnailReady?: boolean
  }
}

type Rect = { x: number; y: number; width: number; height: number }

function bbox(rects: Rect[]) {
  if (rects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    if (r.x < minX) minX = r.x
    if (r.y < minY) minY = r.y
    if (r.x + r.width > maxX) maxX = r.x + r.width
    if (r.y + r.height > maxY) maxY = r.y + r.height
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

export function RenderCanvas({
  projectName,
  artboards,
  textLayers,
}: {
  projectName: string
  artboards: RenderArtboard[]
  textLayers: RenderTextLayer[]
}) {
  const target = artboards.filter((a) => a.iframeUrl)
  const targetCount = target.length
  const [loadedIds, setLoadedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )

  const allLoaded = targetCount === 0 || loadedIds.size >= targetCount

  useEffect(() => {
    if (allLoaded) {
      window.__thumbnailReady = true
      return
    }
    const id = window.setTimeout(() => {
      window.__thumbnailReady = true
    }, READY_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [allLoaded])

  function handleIframeLoad(id: string) {
    setLoadedIds((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  const textRects: Rect[] = textLayers.map((t) => ({
    x: t.x,
    y: t.y,
    width: t.width,
    height: estimateTextHeight(t.text, t.width),
  }))
  const allRects: Rect[] = [...artboards, ...textRects]

  if (allRects.length === 0) {
    return (
      <div
        style={{
          width: VIEWPORT_W,
          height: VIEWPORT_H,
          background: "linear-gradient(135deg, #f4f4f5, #e4e4e7)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          fontSize: 48,
          color: "#71717a",
        }}
        data-thumbnail-root
      >
        {projectName}
      </div>
    )
  }

  const box = bbox(allRects)!
  const scale = Math.min(
    MAX_SCALE,
    (VIEWPORT_W - PADDING * 2) / box.width,
    (VIEWPORT_H - PADDING * 2) / box.height,
  )
  const scaledW = box.width * scale
  const scaledH = box.height * scale
  const offsetX = (VIEWPORT_W - scaledW) / 2
  const offsetY = (VIEWPORT_H - scaledH) / 2

  return (
    <div
      data-thumbnail-root
      style={{
        width: VIEWPORT_W,
        height: VIEWPORT_H,
        background: "#fafafa",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: offsetX,
          top: offsetY,
          width: box.width,
          height: box.height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {artboards.map((a) => (
          <div
            key={a.id}
            style={{
              position: "absolute",
              left: a.x - box.minX,
              top: a.y - box.minY,
              width: a.width,
              height: a.height,
              background: "white",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              overflow: "hidden",
            }}
          >
            {a.iframeUrl ? (
              <iframe
                src={a.iframeUrl}
                onLoad={() => handleIframeLoad(a.id)}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                style={{
                  width: "100%",
                  height: "100%",
                  border: 0,
                  background: "white",
                  pointerEvents: "none",
                }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#a1a1aa",
                  fontFamily: "system-ui, sans-serif",
                  fontSize: 14,
                }}
              >
                {a.label}
              </div>
            )}
          </div>
        ))}
        {textLayers.map((t) => (
          <div
            key={t.id}
            className="tiptap prose prose-sm max-w-none"
            style={{
              position: "absolute",
              left: t.x - box.minX,
              top: t.y - box.minY,
              width: t.width,
              color: "#18181b",
              wordBreak: "break-word",
            }}
            dangerouslySetInnerHTML={{ __html: t.html }}
          />
        ))}
      </div>
    </div>
  )
}
