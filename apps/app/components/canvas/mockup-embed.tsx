"use client"

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import { useTheme } from "next-themes"
import { IconButton } from "@workspace/ui/components/icon-button"
import {
  ArrowsOutSimpleIcon,
  ScribbleIcon,
} from "@workspace/ui/components/icons"
import { cn } from "@workspace/ui/lib/utils"
import { useMockupSrcDoc } from "@/components/agent/file-preview"
import type { LayerShellApi } from "@/components/canvas/layer-shell"
import {
  LivePageContent,
  useLivePage,
  type LivePageWrites,
} from "@/components/canvas/live-page"
import { useMockupPageTheme } from "@/hooks/use-mockup-page-theme"
import { fileModal } from "@/lib/canvas/file-modal"
import type { CanvasOps } from "@/lib/canvas/ops"
import {
  DEFAULT_IFRAME_LAYER_HEIGHT,
  DEFAULT_IFRAME_LAYER_WIDTH,
} from "@/lib/constants"
import { useLayerFile, useMockupLayers } from "@/lib/yjs/react"

/**
 * The canvas's ops, for what an embed's page writes to its file (Knobs and
 * shared state). Outside a canvas there are none and the page writes nothing.
 */
export const CanvasOpsContext = createContext<CanvasOps | null>(null)

/**
 * What the Document holding an embed lends it: the canvas zoom it's drawn at
 * and, while the Document isn't being edited, its body's press handlers, so a
 * press-drag on an embed moves the Document and a click selects it, as one on
 * its text does.
 */
export type DocumentEmbedHost = {
  zoom: number
  body?: Pick<LayerShellApi, "bodyDragHandlers" | "onBodyPointerDownCapture">
}

export const DocumentEmbedHostContext = createContext<DocumentEmbedHost>({
  zoom: 1,
})

const NOBODY_DRIVES = { kind: "none" } as const

/** How tall a page lays out at most, as a multiple of its width. */
const MAX_HEIGHT_PER_WIDTH = 4

/**
 * A Mockup embedded in a Document (#1888, `lib/document-embed.ts`): another
 * live view of the file, its page laid out at the width its views have (or a
 * new view's) and scaled to the Document's, as tall as its content. Under the
 * page, inside the same 1px border, a caption row matches the chat's tile:
 * the kind icon, the name and Open, which shows it in the file modal at 100%.
 * A click focuses the page, so its knobs and links work, until a click lands
 * outside it or Esc. A Mockup that's gone leaves a quiet row with its name
 * struck through.
 */
export function MockupEmbed({
  id,
  name,
  selected,
}: {
  /** The Mockup's file id, or one of its views'. */
  id: string
  /** The name the embed was written with, for when the Mockup is gone. */
  name: string
  /** The embed's block is selected in the editor. */
  selected: boolean
}) {
  const file = useLayerFile(id)
  if (!file || file.kind !== "mockup") {
    return (
      <div
        data-testid="mockup-embed-missing"
        className={cn(
          "flex items-center gap-2 border border-border px-3 py-2 text-sm text-muted-foreground",
          selected && "outline-2 outline-offset-2 outline-ring"
        )}
      >
        <ScribbleIcon aria-hidden className="size-4 shrink-0" />
        <s className="min-w-0 break-words">{name || "Mockup"}</s>
      </div>
    )
  }
  return (
    <LiveMockupEmbed
      fileId={file.id}
      viewId={file.viewIds[0]}
      title={file.title}
      record={file}
      selected={selected}
    />
  )
}

function LiveMockupEmbed({
  fileId,
  viewId,
  title,
  record,
  selected,
}: {
  fileId: string
  viewId: string | undefined
  title: string
  record: NonNullable<ReturnType<typeof useLayerFile>>
  selected: boolean
}) {
  const name = title || "Untitled mockup"
  const { zoom, body } = useContext(DocumentEmbedHostContext)
  const ops = useContext(CanvasOpsContext)
  // The page lays out at the width its views have, or a new view's.
  const mockups = useMockupLayers()
  const view = mockups.find((m) => m.id === viewId)
  const layoutWidth = view?.width ?? DEFAULT_IFRAME_LAYER_WIDTH
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  // As tall as its content once the page says, a view's height until then.
  const fallbackHeight =
    view?.height ??
    (layoutWidth * DEFAULT_IFRAME_LAYER_HEIGHT) / DEFAULT_IFRAME_LAYER_WIDTH
  const layoutHeight = Math.round(
    Math.min(
      Math.max(1, contentHeight ?? fallbackHeight),
      layoutWidth * MAX_HEIGHT_PER_WIDTH
    )
  )

  const rootRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const boxWidth = useWidth(boxRef)
  const scale = boxWidth > 0 ? boxWidth / layoutWidth : 0

  // A click focuses the page; a click anywhere else, or Esc, lets it go.
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setFocused(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocused(false)
    }
    window.addEventListener("pointerdown", onDown, true)
    window.addEventListener("keydown", onKey, true)
    // Focus going into another frame (the canvas's own pages) is a click
    // outside too.
    const onBlur = () => {
      requestAnimationFrame(() => {
        const active = document.activeElement
        if (active instanceof HTMLIFrameElement && active !== iframeRef.current)
          setFocused(false)
      })
    }
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("pointerdown", onDown, true)
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("blur", onBlur)
    }
  }, [focused])

  const embedId = useId()
  const srcDoc = useMockupSrcDoc(fileId)
  const writes = useFilePageWrites(ops, fileId)
  const page = useLivePage({
    // Its own id, one per embed: the views on the canvas register theirs
    // with the drive, and one Mockup can be embedded more than once.
    id: `document-embed-${embedId}`,
    source: { kind: "srcdoc", srcDoc, title: name },
    record,
    writes,
    interactive: focused,
    driver: NOBODY_DRIVES,
    zoom: zoom * scale,
    width: layoutWidth,
    height: layoutHeight,
    iframeRef,
    bodyRef,
    onContentHeight: (_id, height) => setContentHeight(height),
  })
  const { resolvedTheme } = useTheme()
  useMockupPageTheme(
    page.port,
    resolvedTheme ? (resolvedTheme === "dark" ? "dark" : "light") : null
  )

  // A press that moves is a drag of the Document, not a click on the page.
  const pressRef = useRef<{ x: number; y: number } | null>(null)
  return (
    <div
      ref={rootRef}
      data-testid="mockup-embed"
      data-file-id={fileId}
      data-focused={focused ? "" : undefined}
      // The Document's body lets the pointer through to the layer at rest;
      // the embed takes it, so it can be clicked and opened.
      style={{ pointerEvents: "auto" }}
      className={cn(
        "border border-border bg-background",
        (selected || focused) && "outline-2 outline-offset-2 outline-ring"
      )}
    >
      <div
        ref={boxRef}
        className="relative overflow-hidden bg-white"
        style={{ height: scale > 0 ? layoutHeight * scale : undefined }}
      >
        {scale > 0 && (
          <div
            ref={bodyRef}
            className="absolute top-0 left-0 origin-top-left"
            style={{
              width: layoutWidth,
              height: layoutHeight,
              transform: `scale(${scale})`,
            }}
          >
            <LivePageContent page={page} iframeRef={iframeRef} />
          </div>
        )}
        {!focused && (
          <div
            data-testid="mockup-embed-overlay"
            className="absolute inset-0"
            onPointerDownCapture={body?.onBodyPointerDownCapture}
            onPointerMove={body?.bodyDragHandlers?.onPointerMove}
            onPointerUp={body?.bodyDragHandlers?.onPointerUp}
            onPointerDown={(e) => {
              pressRef.current = { x: e.clientX, y: e.clientY }
              body?.bodyDragHandlers?.onPointerDown(e)
            }}
            onClick={(e) => {
              const press = pressRef.current
              pressRef.current = null
              if (
                press &&
                Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4
              )
                return
              setFocused(true)
            }}
          />
        )}
      </div>
      <div className="flex min-w-0 items-start gap-2 border-t border-border py-1 pr-1 pl-3 text-sm">
        <ScribbleIcon aria-hidden className="mt-1.5 size-4 shrink-0" />
        <span
          data-slot="mockup-embed-name"
          className="min-w-0 flex-1 py-1 break-words"
        >
          {name}
        </span>
        <IconButton
          label="Open"
          // Not part of the Document's text: the editor leaves it alone.
          contentEditable={false}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            fileModal.open(fileId)
          }}
        >
          <ArrowsOutSimpleIcon />
        </IconButton>
      </div>
    </div>
  )
}

/** The box's layout width, following its resizes; zero until measured. */
function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}

/**
 * Where a Mockup page shown away from its views (the modal, an embed in a
 * Document) writes its Knobs and shared state: the file, as a view's are.
 * Outside a canvas there are no ops, and it writes nothing.
 */
export function useFilePageWrites(
  ops: CanvasOps | null,
  fileId: string
): LivePageWrites | undefined {
  return useMemo<LivePageWrites | undefined>(
    () =>
      ops
        ? {
            knobsDeclared: (_id, knobs) => {
              const current = ops.fileOf(fileId)
              if (
                JSON.stringify(current?.knobs ?? []) === JSON.stringify(knobs)
              )
                return
              ops.patch("layerFiles", fileId, { knobs })
            },
            knobValues: (_id, knobValues) =>
              ops.patch("layerFiles", fileId, { knobValues }),
            sharedState: (_id, sharedState) =>
              ops.patch("layerFiles", fileId, { sharedState }),
          }
        : undefined,
    [ops, fileId]
  )
}
