import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react"
import type { ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch"

import type { useAppSession } from "@/lib/auth-client"
import { fitRectToViewport, fitScale, type Rect } from "@/lib/canvas/camera"
import { CANVAS_SIZE, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "@/lib/constants"
import type { CanvasPresence } from "@/lib/yjs/react"
import type { ViewportData } from "@/lib/types"
import type { WheelForward } from "@/hooks/use-screenplay-dom"

/**
 * Canvas Camera controller (PRD #567) — one owner for zoom, viewport position,
 * persistence, presence broadcast, and following another user, lifted out of
 * `components/canvas/canvas.tsx`.
 *
 * It owns the `react-zoom-pan-pinch` transform ref and the `zoom` / viewport
 * mirrors, the debounced viewport persistence (through the injected
 * `saveViewport`, a thin wrapper over `ops.saveViewport`), the presence
 * viewport broadcast, the follow-another-user effect (writing the transform
 * from a peer's presence) and the wheel/pinch follow-break, and the Figma-style
 * wheel pan/zoom. The pure zoom-to-fit math lives in `lib/canvas/camera`; this
 * controller applies it via the transform ref.
 *
 * Overlays, the comments transform, the gesture inputs, and the sidebar
 * zoom-to actions all read this one interface — `zoom`, `viewportPos`, the
 * transform ref, and the verbs `zoomToElement` / `zoomToRect` /
 * `getViewportCenter` / `follow` — and the `TransformWrapper` wiring shrinks to
 * the `transformWrapperProps` bundle this exposes.
 *
 * As the canvas **presence owner** (PRD #588) it also owns the two remaining
 * awareness-publish effects beyond the viewport broadcast: the identity +
 * stable-color publish (with the placeholder-viewport seed so `useSelfPresence`
 * is non-null before `onInit`), and the selection → presence broadcast that
 * remote selection rings read. The scroll-pin effect that keeps the viewport's
 * wrapper from drifting off-axis lives here too, beside the transform it guards.
 */
export interface CanvasCameraDeps {
  /** The react-zoom-pan-pinch transform ref the component owns and the camera
   *  drives. Owned by the component (not returned here) so the React Compiler
   *  lint doesn't treat the camera's plain values as ref-tainted. */
  transformRef: RefObject<ReactZoomPanPinchContentRef | null>
  /** The canvas wrapper the Figma-style wheel listener attaches to. */
  canvasWrapperRef: RefObject<HTMLDivElement | null>
  /** Awareness writer — viewport (and the follow self-broadcast) ride on it. */
  setPresence: (partial: Partial<CanvasPresence>) => void
  /** The signed-in user — its identity is published into awareness on mount. */
  session: ReturnType<typeof useAppSession>["data"]
  /** Persist the viewport (a thin wrapper over `ops.saveViewport`). */
  saveViewport: (vp: ViewportData) => void
  /** The viewport restored from the Y.Doc on first load, if any. */
  savedViewport: ViewportData | null
  /** Other peers' presence — the follow effect reads the followed viewport. */
  others: Array<{ clientId: number; presence: CanvasPresence }>
  /** Local selection ids broadcast into awareness for remote selection rings. */
  overlaySelectedIds: Set<string>
  groupSelectedIframeLayerIds: Set<string>
  /** Interaction modes that disable canvas panning / change the wheel target. */
  focusedIframeLayerId: string | null
  createFlowIframeLayerId: string | null
  editingDocumentLayerId: string | null
  /** Space-held arms left-click panning. */
  spaceHeld: boolean
}

export interface CanvasCamera {
  zoom: number
  viewportPos: { x: number; y: number }
  isPanning: boolean
  followingConnectionId: number | null
  /** Follow a peer's viewport (or `null` to stop following). */
  follow(connectionId: number | null): void
  /** Stop following when the user takes manual control (pan / wheel / pinch). */
  breakFollow(): void
  /** Canvas-space center of the current viewport. */
  getViewportCenter(): { cx: number; cy: number }
  /** Zoom to fit a DOM element (frame / doc) with padding. */
  zoomToElement(el: HTMLElement): void
  /** Zoom to fit a world-space rect with padding (e.g. a whole Group). */
  zoomToRect(rect: Rect): void
  /** Forwarded wheel from inside an interactive iframe (cursor-centered zoom). */
  handleIframeWheel(iframeLayerId: string, w: WheelForward): void
  /** The `TransformWrapper` props this controller owns. */
  transformWrapperProps: CameraTransformWrapperProps
}

/** The subset of `TransformWrapper` props the camera controller owns. */
export interface CameraTransformWrapperProps {
  initialScale: number
  initialPositionX: number
  initialPositionY: number
  minScale: number
  maxScale: number
  limitToBounds: boolean
  centerOnInit: boolean
  doubleClick: { disabled: boolean }
  wheel: { disabled: boolean }
  trackPadPanning: { disabled: boolean }
  panning: {
    velocityDisabled: boolean
    disabled: boolean
    allowLeftClickPan: boolean
    allowMiddleClickPan: boolean
  }
  onInit: (ref: ReactZoomPanPinchContentRef) => void
  onPanningStart: () => void
  onPanningStop: () => void
  onWheelStart: () => void
  onPinchStart: () => void
  onTransform: (
    ref: ReactZoomPanPinchContentRef,
    state: { positionX: number; positionY: number; scale: number }
  ) => void
}

const FIT_PADDING = 20

export function useCanvasCamera(deps: CanvasCameraDeps): CanvasCamera {
  const {
    transformRef,
    canvasWrapperRef,
    setPresence,
    session,
    saveViewport,
    savedViewport,
    others,
    overlaySelectedIds,
    groupSelectedIframeLayerIds,
    focusedIframeLayerId,
    createFlowIframeLayerId,
    editingDocumentLayerId,
    spaceHeld,
  } = deps

  const [zoom, setZoom] = useState(1)
  const [viewportPos, setViewportPos] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [followingConnectionId, setFollowingConnectionId] = useState<
    number | null
  >(null)
  const viewportRestoredRef = useRef(false)

  const follow = useCallback(
    (connectionId: number | null) => setFollowingConnectionId(connectionId),
    []
  )

  // Stop following the instant the user manually pans / zooms.
  const breakFollow = useCallback(() => {
    setFollowingConnectionId((prev) => (prev !== null ? null : prev))
  }, [])

  // --- Persistence (debounced) ---
  const saveViewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const saveViewportDebounced = useCallback(
    (vp: ViewportData) => {
      if (saveViewportTimerRef.current)
        clearTimeout(saveViewportTimerRef.current)
      saveViewportTimerRef.current = setTimeout(() => saveViewport(vp), 500)
    },
    [saveViewport]
  )

  // Restore the saved viewport once it arrives (covers the case where the
  // synced viewport lands after TransformWrapper's onInit already fired).
  useEffect(() => {
    if (viewportRestoredRef.current) return
    if (!savedViewport) return
    const ref = transformRef.current
    if (!ref) return
    viewportRestoredRef.current = true
    ref.setTransform(savedViewport.x, savedViewport.y, savedViewport.zoom, 0)
    setZoom(savedViewport.zoom)
    setViewportPos({ x: savedViewport.x, y: savedViewport.y })
    setPresence({ viewport: savedViewport })
  }, [transformRef, savedViewport, setPresence])

  // --- Presence: identity publish + placeholder-viewport seed ---
  // Publish identity + a stable color into awareness on mount and whenever the
  // session changes. Seed a placeholder viewport so `useSelfPresence` returns
  // non-null before TransformWrapper's `onInit` fires (otherwise the self
  // avatar is missing from the pile until the first transform state ticks in).
  // Ordered after the restore effect so a restored viewport isn't transiently
  // re-seeded to the placeholder, matching the prior root-effect ordering.
  const colorRef = useRef<string>("")
  useEffect(() => {
    if (!session?.user) return
    if (!colorRef.current) {
      const palette = [
        "#E57373",
        "#64B5F6",
        "#81C784",
        "#FFB74D",
        "#BA68C8",
        "#4DD0E1",
        "#FF8A65",
        "#A1887F",
      ]
      colorRef.current = palette[Math.floor(Math.random() * palette.length)]!
    }
    setPresence({
      identity: {
        id: session.user.id,
        name: session.user.name || "Anonymous",
        avatar: session.user.image ?? undefined,
      },
      color: colorRef.current,
      viewport: { x: 0, y: 0, zoom: 1 },
    })
  }, [session, setPresence])

  // --- Presence: broadcast selection to other users ---
  // Doc IDs ride alongside iframeLayer IDs so remote selection rings render
  // uniformly (the overlay looks both up against `iframeLayerLayouts`, which
  // already includes docs).
  useEffect(() => {
    setPresence({
      selectedIframeLayerIds: Array.from(overlaySelectedIds),
      groupSelectedIframeLayerIds: Array.from(groupSelectedIframeLayerIds),
    })
  }, [overlaySelectedIds, groupSelectedIframeLayerIds, setPresence])

  // --- Scroll-pin: keep the viewport wrapper anchored at (0, 0) ---
  // Cross-origin iframes inside an iframeLayer can cause the browser to walk up
  // the ancestor chain calling `scrollIntoView` (e.g. when their content
  // autofocuses an input). `overflow: hidden` does not block programmatic
  // scrolling, so the canvas wrapper / transform wrapper silently drift from
  // (0, 0) and the rendered canvas slides off-axis from the transform state.
  // Pin both elements' scroll positions to 0 on every scroll event.
  useEffect(() => {
    const el = canvasWrapperRef.current
    if (!el) return

    const transformWrapper = el.querySelector<HTMLElement>(
      ".react-transform-wrapper"
    )

    const pin = (e: Event) => {
      const t = e.currentTarget as HTMLElement
      if (t.scrollLeft !== 0) t.scrollLeft = 0
      if (t.scrollTop !== 0) t.scrollTop = 0
    }

    const targets: HTMLElement[] = [el]
    if (transformWrapper) targets.push(transformWrapper)
    for (const t of targets) {
      t.addEventListener("scroll", pin, { passive: true })
    }
    return () => {
      for (const t of targets) {
        t.removeEventListener("scroll", pin)
      }
    }
  }, [canvasWrapperRef])

  // --- Camera verbs ---
  const getViewportCenter = useCallback(() => {
    const ref = transformRef.current
    let cx = CANVAS_SIZE / 2
    let cy = CANVAS_SIZE / 2
    if (ref) {
      const { positionX, positionY, scale } = ref.state
      const w = window.innerWidth
      const h = window.innerHeight
      cx = (-positionX + w / 2) / scale
      cy = (-positionY + h / 2) / scale
    }
    return { cx, cy }
  }, [transformRef])

  const zoomToElement = useCallback(
    (el: HTMLElement) => {
      const ref = transformRef.current
      if (!ref) return
      const wrapperW =
        ref.instance.wrapperComponent?.clientWidth ?? window.innerWidth
      const wrapperH =
        ref.instance.wrapperComponent?.clientHeight ?? window.innerHeight
      const scale = fitScale(
        el.offsetWidth,
        el.offsetHeight,
        { width: wrapperW, height: wrapperH },
        { padding: FIT_PADDING, maxZoom: ZOOM_MAX }
      )
      ref.zoomToElement(el, scale, 300)
    },
    [transformRef]
  )

  const zoomToRect = useCallback(
    (rect: Rect) => {
      const ref = transformRef.current
      if (!ref) return
      if (rect.width <= 0 || rect.height <= 0) return
      const wrapperW =
        ref.instance.wrapperComponent?.clientWidth ?? window.innerWidth
      const wrapperH =
        ref.instance.wrapperComponent?.clientHeight ?? window.innerHeight
      const t = fitRectToViewport(
        rect,
        { width: wrapperW, height: wrapperH },
        { padding: FIT_PADDING, maxZoom: ZOOM_MAX }
      )
      ref.setTransform(t.x, t.y, t.zoom, 300)
    },
    [transformRef]
  )

  // --- Follow another user's viewport ---
  useEffect(() => {
    if (followingConnectionId === null) return
    const followed = others.find((o) => o.clientId === followingConnectionId)
    // If the user we're following disconnected, stop following.
    if (!followed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFollowingConnectionId(null)
      return
    }
    const { viewport } = followed.presence
    const ref = transformRef.current
    if (!ref) return
    // Only move if our viewport actually differs.
    const { positionX, positionY, scale } = ref.state
    const dx = Math.abs(positionX - viewport.x)
    const dy = Math.abs(positionY - viewport.y)
    const dz = Math.abs(scale - viewport.zoom)
    if (dx < 1 && dy < 1 && dz < 0.001) return
    ref.setTransform(viewport.x, viewport.y, viewport.zoom, 200)
  }, [transformRef, followingConnectionId, others])

  // --- Figma-style wheel: scroll = pan, Ctrl/Cmd+scroll = zoom ---
  useEffect(() => {
    const el = canvasWrapperRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      // In focus / Create Flow mode the focused frame owns plain scrolling. When
      // the wheel leaks to this wrapper (over a loading overlay or title-bar
      // chrome) panning the canvas would steal the scroll the user meant for the
      // frame — bail so the frame keeps the gesture. Zoom (ctrl/cmd) still falls
      // through so pinch-zoom over a focused frame works.
      const activeFrameId = focusedIframeLayerId ?? createFlowIframeLayerId
      if (activeFrameId && !e.ctrlKey && !e.metaKey) {
        const frameEl = document.getElementById(`iframe-layer-${activeFrameId}`)
        if (frameEl && frameEl.contains(e.target as Node)) return
      }
      e.preventDefault()
      const ref = transformRef.current
      if (!ref) return
      if (followingConnectionId !== null) setFollowingConnectionId(null)
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        const cursorX = e.clientX - rect.left
        const cursorY = e.clientY - rect.top
        const { positionX, positionY, scale } = ref.state
        const delta = -e.deltaY
        const factor = 1 + delta * ZOOM_STEP
        const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale * factor))
        const ratio = newScale / scale
        const newPosX = cursorX - (cursorX - positionX) * ratio
        const newPosY = cursorY - (cursorY - positionY) * ratio
        ref.setTransform(newPosX, newPosY, newScale, 0)
      } else {
        const { positionX, positionY, scale } = ref.state
        ref.setTransform(positionX - e.deltaX, positionY - e.deltaY, scale, 0)
      }
    }

    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [
    transformRef,
    canvasWrapperRef,
    followingConnectionId,
    focusedIframeLayerId,
    createFlowIframeLayerId,
  ])

  // Zoom gestures landing on an interactive iframe can't reach the wrapper-level
  // wheel listener (the cross-origin iframe captures them). The bridge forwards
  // them here so a pinch zooms the canvas centered on the cursor.
  const handleIframeWheel = useCallback(
    (iframeLayerId: string, w: WheelForward) => {
      const ref = transformRef.current
      const wrapper = canvasWrapperRef.current
      if (!ref || !wrapper) return
      const frameEl = document.getElementById(`iframe-layer-${iframeLayerId}`)
      if (!frameEl) return
      if (followingConnectionId !== null) setFollowingConnectionId(null)
      const wrapperRect = wrapper.getBoundingClientRect()
      const frameRect = frameEl.getBoundingClientRect()
      const { positionX, positionY, scale } = ref.state
      const cursorX = frameRect.left - wrapperRect.left + w.clientX * scale
      const cursorY = frameRect.top - wrapperRect.top + w.clientY * scale
      const delta = -w.deltaY
      const factor = 1 + delta * ZOOM_STEP
      const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale * factor))
      const ratio = newScale / scale
      const newPosX = cursorX - (cursorX - positionX) * ratio
      const newPosY = cursorY - (cursorY - positionY) * ratio
      ref.setTransform(newPosX, newPosY, newScale, 0)
    },
    [transformRef, canvasWrapperRef, followingConnectionId]
  )

  // --- TransformWrapper props (init / transform / panning gates) ---
  const onInit = useCallback(
    (ref: ReactZoomPanPinchContentRef) => {
      if (!viewportRestoredRef.current && savedViewport) {
        viewportRestoredRef.current = true
        ref.setTransform(
          savedViewport.x,
          savedViewport.y,
          savedViewport.zoom,
          0
        )
        setZoom(savedViewport.zoom)
        setViewportPos({ x: savedViewport.x, y: savedViewport.y })
        setPresence({ viewport: savedViewport })
      } else {
        const { scale, positionX, positionY } = ref.state
        setZoom(scale)
        setViewportPos({ x: positionX, y: positionY })
        setPresence({
          viewport: { x: positionX, y: positionY, zoom: scale },
        })
      }
    },
    [savedViewport, setPresence]
  )

  const onPanningStart = useCallback(() => {
    breakFollow()
    setIsPanning(true)
  }, [breakFollow])
  const onPanningStop = useCallback(() => setIsPanning(false), [])

  const onTransform = useCallback(
    (
      _ref: ReactZoomPanPinchContentRef,
      state: { positionX: number; positionY: number; scale: number }
    ) => {
      const vp = { x: state.positionX, y: state.positionY, zoom: state.scale }
      setZoom(state.scale)
      setViewportPos({ x: state.positionX, y: state.positionY })
      setPresence({ viewport: vp })
      saveViewportDebounced(vp)
    },
    [setPresence, saveViewportDebounced]
  )

  const transformWrapperProps = useMemo<CameraTransformWrapperProps>(
    () => ({
      initialScale: 1,
      initialPositionX:
        -CANVAS_SIZE / 2 +
        (typeof window !== "undefined" ? window.innerWidth / 2 : 500),
      initialPositionY:
        -CANVAS_SIZE / 2 +
        (typeof window !== "undefined" ? window.innerHeight / 2 : 400),
      minScale: ZOOM_MIN,
      maxScale: ZOOM_MAX,
      limitToBounds: false,
      centerOnInit: false,
      doubleClick: { disabled: true },
      wheel: { disabled: true },
      trackPadPanning: { disabled: true },
      panning: {
        velocityDisabled: true,
        disabled:
          focusedIframeLayerId !== null ||
          createFlowIframeLayerId !== null ||
          editingDocumentLayerId !== null,
        allowLeftClickPan: spaceHeld,
        allowMiddleClickPan: true,
      },
      onInit,
      onPanningStart,
      onPanningStop,
      onWheelStart: breakFollow,
      onPinchStart: breakFollow,
      onTransform,
    }),
    [
      focusedIframeLayerId,
      createFlowIframeLayerId,
      editingDocumentLayerId,
      spaceHeld,
      onInit,
      onPanningStart,
      onPanningStop,
      breakFollow,
      onTransform,
    ]
  )

  return {
    zoom,
    viewportPos,
    isPanning,
    followingConnectionId,
    follow,
    breakFollow,
    getViewportCenter,
    zoomToElement,
    zoomToRect,
    handleIframeWheel,
    transformWrapperProps,
  }
}
