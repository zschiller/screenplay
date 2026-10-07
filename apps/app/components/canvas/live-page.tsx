"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ReactNode, RefObject } from "react"

import { useDriveFrame } from "@/components/canvas/frame-drive-relay"
import {
  FrameDriverButton,
  FrameDriverTag,
  FrameGoLiveToggle,
  FrameLiveTag,
} from "@/components/canvas/frame-driver"
import { FrameStreamView } from "@/components/canvas/frame-stream-view"
import { KnobsPopover } from "@/components/canvas/knobs-popover"
import type { LayerShellApi } from "@/components/canvas/layer-shell"
import type {
  FrameDriverView,
  FrameRequesterView,
} from "@/components/canvas/use-frame-control"
import { useIframeBridgePort } from "@/hooks/use-bridge-port"
import { usePostMessage } from "@/hooks/use-postmessage"
import {
  useScreenplayDom,
  type ScreenplayDom,
  type WheelForward,
} from "@/hooks/use-screenplay-dom"
import type { BridgePort } from "@/lib/bridge-port"
import { drivenByOther } from "@/lib/canvas/frame-control"
import { canInteractOnDoubleClick } from "@/lib/canvas/interaction-mode"
import type { FrameColorScheme } from "@/lib/frame-stream/protocol"
import type { FrameStreamConnection } from "@/lib/frame-stream/client"
import type {
  DomRect,
  HmrStatus,
  JsonObject,
  JsonValue,
} from "@/lib/postmessage-protocol"

/**
 * The Live Page (#1493): a sandboxed page on the canvas that runs the Sandbox
 * Bridge, so it can be interacted with, driven by the agent, targeted by a
 * pick or a comment, and can declare Knobs and share state. Frames and
 * Mockups are both one; they differ only in where the page comes from:
 *
 * - `url`: a frame's own copy, an iframe on the Workspace's preview.
 * - `stream`: a live frame or Mockup, the shared browser seen through its
 *   Frame Stream (#1392, #1516, #1523).
 * - `srcdoc`: a Mockup's static HTML (#1309), in an opaque-origin iframe that
 *   may run scripts and nothing else.
 *
 * The layer calls {@link useLivePage} for the bridge, then renders
 * {@link LivePageContent} (the page), {@link LivePageOverlay} (drag, Interact
 * on double-click, the target hover and the pick scrim) and
 * {@link LivePageControls} (Interact, Go live and Knobs on its bar), and takes
 * its title tag and resize rule from {@link livePageChrome}. What a layer adds
 * around them (a frame's address bar and status screens, a Mockup's status)
 * stays in the layer.
 */

export type LivePageSource =
  | {
      kind: "url"
      /** The URL the iframe shows; no iframe until there is one. */
      src: string | undefined
    }
  | {
      kind: "srcdoc"
      /** The whole document; no iframe until there is one. */
      srcDoc: string | undefined
      title: string
    }
  | {
      kind: "stream"
      stream: FrameStreamConnection
      /** Whether there's a page to show yet (the Workspace's preview is up). */
      hasPage: boolean
      route: string
      scheme: FrameColorScheme
      /** A Mockup's page (#1523), which the shared browser shows in place
       *  of the Workspace's preview. */
      doc?: string
      /** Where the shared page went; `first` is the report on joining. */
      onRoute: (path: string, first: boolean) => void
      /** The picture is up (or gone). */
      onLive: (live: boolean) => void
      /** This viewer's input reached the page (Frame Control's idle clock). */
      onActivity?: () => void
    }

/** Where a page's Knobs and shared state are written: its layer record. */
export interface LivePageWrites {
  /** The knobs the page declared, written only when they change. */
  knobsDeclared: (id: string, knobs: JsonValue[]) => void
  knobValues: (id: string, values: JsonObject) => void
  sharedState: (id: string, state: JsonObject) => void
}

/** What the layer record holds for the page, replayed to it as it loads. */
export interface LivePageRecord {
  iframeState?: JsonObject
  scrollX?: number
  scrollY?: number
  knobs?: JsonValue[]
  knobValues?: JsonObject
  sharedState?: JsonObject
}

/** What the bridge reports that only a frame's app uses. */
export interface LivePageAppEvents {
  onStateChanged?: (id: string, state: JsonObject) => void
  onNavigation?: (id: string, path: string, replace: boolean) => void
  onScroll?: (id: string, scrollX: number, scrollY: number) => void
  onReady?: (id: string, version: string | undefined) => void
  onHmrStatus?: (id: string, status: HmrStatus) => void
}

export interface LivePageOptions {
  id: string
  source: LivePageSource
  record: LivePageRecord
  writes?: LivePageWrites
  app?: LivePageAppEvents
  /** The page takes the pointer and keys (Interact, or recording a flow). */
  interactive: boolean
  /** Who drives the page as this viewer sees it. */
  driver: FrameDriverView
  zoom: number
  width: number
  height: number
  /** A pinch or ⌘-scroll over the interacting page, to zoom the canvas. */
  onWheel?: (id: string, wheel: WheelForward) => void
  /** Register the page's DOM bridge (null on unmount). */
  onDomReady?: (id: string, dom: ScreenplayDom | null) => void
  /** The page's iframe; {@link LivePageContent} attaches it. */
  iframeRef: RefObject<HTMLIFrameElement | null>
  /** The box the page fills, which hit-tests measure. */
  bodyRef: RefObject<HTMLDivElement | null>
  /**
   * The agent's screenshot is read from the page (a Mockup on hosted, where
   * no browser can photograph someone's canvas).
   */
  snapshot?: boolean
  /** Fit to content is on: the content's height, each time it changes. */
  onContentHeight?: (id: string, height: number) => void
}

export interface LivePage {
  id: string
  source: LivePageSource
  record: LivePageRecord
  writes?: LivePageWrites
  interactive: boolean
  /**
   * The page takes the pointer: in Interact, or for the moment a gesture the
   * agent plays with real input on the Mac lands (#1385).
   */
  takesPointer: boolean
  driver: FrameDriverView
  width: number
  height: number
  port: BridgePort
  dom: ScreenplayDom
  /** The page's element under a screen point, or null outside the page. */
  elementAt: (
    clientX: number,
    clientY: number
  ) => ReturnType<ScreenplayDom["elementAtPoint"]> | Promise<null>
}

const NO_STATE: JsonObject = {}
const ignoreState = () => {}

/** The bridge to a page on the canvas and everything wired to it. */
export function useLivePage({
  id,
  source,
  record,
  writes,
  app,
  interactive,
  driver,
  zoom,
  width,
  height,
  onWheel,
  onDomReady,
  iframeRef,
  bodyRef,
  snapshot = false,
  onContentHeight,
}: LivePageOptions): LivePage {
  // The iframe's bridge, or the shared page's over its stream (#1394), so
  // pins, Knobs, the picker and Fit to content work on both alike.
  const iframePort = useIframeBridgePort(iframeRef)
  const stream = source.kind === "stream" ? source.stream : undefined
  const port = useMemo(
    () => (stream ? stream.bridgePort(id) : iframePort),
    [stream, id, iframePort]
  )

  usePostMessage({
    port,
    iframeLayerId: id,
    iframeState: record.iframeState ?? NO_STATE,
    iframeScrollX: record.scrollX,
    iframeScrollY: record.scrollY,
    knobValues: record.knobValues,
    sharedState: record.sharedState,
    onStateChanged: app?.onStateChanged ?? ignoreState,
    onNavigation: app?.onNavigation,
    onScroll: app?.onScroll,
    onReady: app?.onReady,
    onHmrStatus: app?.onHmrStatus,
    onKnobsDeclared: writes?.knobsDeclared,
    onSharedStateChanged: writes?.sharedState,
  })

  useContentHeight(port, id, onContentHeight)

  const dom = useScreenplayDom(port, {
    onWheel: (wheel) => onWheel?.(id, wheel),
    // Esc the page didn't claim, forwarded by the bridge because keydowns
    // never leave the iframe. Replay it on the canvas's own window so it
    // walks the same Escape precedence (lib/canvas/escape.ts) as an Esc
    // pressed on the canvas: an armed pick cancels first, otherwise the page
    // leaves interaction.
    // Space pressed in the page with the pointer out over the canvas, so
    // space-drag pans the canvas as it does outside Interact.
    onSpaceDown: () => {
      if (!interactive) return
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }))
    },
    onSpaceUp: () => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }))
    },
    onEscape: () => {
      if (!interactive) return
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    },
  })

  // The agent drives the page through the drive channel (#1389, #1391).
  const [agentPointer, setAgentPointer] = useState(false)
  useDriveFrame(id, dom, iframeRef, zoom, {
    snapshot,
    setTakesPointer: setAgentPointer,
  })

  // Leaving interaction (Esc, the toolbar, or a deselect) hands keyboard focus
  // back to the canvas. Otherwise it stays inside the iframe, and canvas
  // shortcuts, a second Esc included, go to the page instead.
  useEffect(() => {
    if (interactive) {
      // Entering from the toolbar leaves focus on the Interact button, where
      // Space would press it (leaving Interact) instead of panning the canvas.
      const active = document.activeElement
      if (
        active instanceof HTMLElement &&
        active.closest("#frame-toolbar-portal")
      )
        active.blur()
      return
    }
    const iframe = iframeRef.current
    if (iframe && document.activeElement === iframe) iframe.blur()
  }, [interactive, iframeRef])

  const onDomReadyRef = useRef(onDomReady)
  useEffect(() => {
    onDomReadyRef.current = onDomReady
  })
  useEffect(() => {
    onDomReadyRef.current?.(id, dom)
    return () => onDomReadyRef.current?.(id, null)
  }, [id, dom])

  // The page lays out at the layer's own size inside the zoomed canvas: its
  // box's screen rect is the scaled size, the page's viewport (and what
  // elementFromPoint uses) isn't, so a screen point maps back into it by
  // dividing by zoom.
  const elementAt = useCallback(
    async (clientX: number, clientY: number) => {
      const body = bodyRef.current
      if (!body) return null
      const rect = body.getBoundingClientRect()
      const x = (clientX - rect.left) / zoom
      const y = (clientY - rect.top) / zoom
      if (x < 0 || y < 0 || x > width || y > height) return null
      try {
        return await dom.elementAtPoint(x, y)
      } catch {
        return null
      }
    },
    [bodyRef, dom, zoom, width, height]
  )

  return {
    id,
    source,
    record,
    writes,
    interactive,
    takesPointer: interactive || agentPointer,
    driver,
    width,
    height,
    port,
    dom,
    elementAt,
  }
}

/**
 * While Fit to content is on, the bridge reports the content's height as it
 * changes. Asked again on each `ready`, since a page that reloads forgets.
 */
function useContentHeight(
  port: BridgePort,
  id: string,
  onContentHeight: ((id: string, height: number) => void) | undefined
) {
  const on = !!onContentHeight
  const onContentHeightRef = useRef(onContentHeight)
  useEffect(() => {
    onContentHeightRef.current = onContentHeight
  })
  useEffect(() => {
    if (!on) return
    const watch = () => port.post({ type: "screenplay:watch-content-size", on })
    watch()
    const unsubscribe = port.subscribe((data) => {
      if (data.type === "screenplay:ready") watch()
      else if (data.type === "screenplay:content-size")
        onContentHeightRef.current?.(id, data.height)
    })
    return () => {
      unsubscribe()
      port.post({ type: "screenplay:watch-content-size", on: false })
    }
  }, [port, id, on])
}

/** The page itself: an iframe, or the shared browser's picture. */
export function LivePageContent({
  page,
  iframeRef,
}: {
  page: LivePage
  /** The same ref the page was made with. */
  iframeRef: RefObject<HTMLIFrameElement | null>
}) {
  const { source } = page
  if (source.kind === "stream") {
    if (!source.hasPage) return null
    return (
      <FrameStreamView
        stream={source.stream}
        frame={source.stream.frame(page.id)}
        width={page.width}
        height={page.height}
        route={source.route}
        scheme={source.scheme}
        doc={source.doc}
        interactive={page.interactive}
        drives={page.driver.kind === "you"}
        onRoute={source.onRoute}
        onLive={source.onLive}
        onActivity={source.onActivity}
      />
    )
  }
  return <LivePageFrame page={page} iframeRef={iframeRef} />
}

/** A frame longer than this means the page is still catching up. */
const LONG_FRAME_MS = 24

/** The longest a page's size waits for a short frame while it changes. */
const RESIZE_MAX_WAIT_MS = 100

/**
 * The page's size, following a resize live: each animation frame takes the
 * latest size. A page re-lays out and repaints at each new size, on the
 * canvas's own thread in WebKit, so a heavy page can make a frame long; the
 * next size then waits for a short frame, or {@link RESIZE_MAX_WAIT_MS}, so
 * the drag itself never stalls behind the page. A light page follows every
 * frame of the drag.
 */
function useFollowedSize(width: number, height: number) {
  const [shown, setShown] = useState({ width, height })
  const target = useRef({ width, height })
  const shownRef = useRef(shown)
  useLayoutEffect(() => {
    target.current = { width, height }
    shownRef.current = shown
  })
  const loop = useRef<number | null>(null)
  const lastApplied = useRef(-Infinity)
  useEffect(() => {
    if (shown.width === width && shown.height === height) return
    if (loop.current !== null) return
    let lastTick = performance.now()
    const tick = (now: number) => {
      const frame = now - lastTick
      lastTick = now
      const next = target.current
      const current = shownRef.current
      if (next.width === current.width && next.height === current.height) {
        loop.current = null
        return
      }
      if (
        frame < LONG_FRAME_MS ||
        now - lastApplied.current >= RESIZE_MAX_WAIT_MS
      ) {
        lastApplied.current = now
        setShown(next)
      }
      loop.current = requestAnimationFrame(tick)
    }
    loop.current = requestAnimationFrame(tick)
  }, [width, height, shown])
  useEffect(
    () => () => {
      if (loop.current !== null) cancelAnimationFrame(loop.current)
    },
    []
  )
  return shown
}

function LivePageFrame({
  page,
  iframeRef,
}: {
  page: LivePage
  iframeRef: RefObject<HTMLIFrameElement | null>
}) {
  const { source } = page
  const settled = useFollowedSize(page.width, page.height)
  const style = {
    pointerEvents: page.takesPointer ? "auto" : "none",
    // Offsets from the box, so a size a frame behind keeps the box's own
    // insets.
    width: `calc(100% + ${settled.width - page.width}px)`,
    height: `calc(100% + ${settled.height - page.height}px)`,
  } as const
  if (source.kind === "srcdoc") {
    if (source.srcDoc === undefined) return null
    return (
      <iframe
        ref={iframeRef}
        title={source.title}
        srcDoc={source.srcDoc}
        // Scripts only: no same-origin, forms, popups or top navigation.
        sandbox="allow-scripts"
        className="absolute top-0 left-0 border-0 bg-white"
        style={style}
        tabIndex={page.interactive ? 0 : -1}
      />
    )
  }
  if (source.kind !== "url" || !source.src) return null
  return (
    <iframe
      ref={iframeRef}
      src={source.src}
      className="absolute top-0 left-0 border-0 bg-white dark:bg-neutral-900"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      style={style}
    />
  )
}

/**
 * The scrim over a page an armed pick can't hit, and, outside interaction,
 * the transparent overlay that drags and selects the layer, tracks the
 * element a comment or pick would target, and enters Interact on a
 * double-click (or, with `onOpen`, opens the page elsewhere).
 */
export function LivePageOverlay({
  page,
  api,
  hasPage,
  commentMode = false,
  pickActive = false,
  dimmed = false,
  spaceHeld,
  onHover,
  onSelect,
  onFocus,
  onOpen,
}: {
  page: LivePage
  api: LayerShellApi
  /** There's a page to interact with. */
  hasPage: boolean
  /** Comment placement owns the pointer and shows the element it would pin. */
  commentMode?: boolean
  /** An element pick is armed and can hit this page. */
  pickActive?: boolean
  /**
   * An element pick is armed that can't hit this page (#619): a wash makes
   * the eligible ones stand out, and the click falls through to the canvas,
   * which treats it as a cancel.
   */
  dimmed?: boolean
  spaceHeld: boolean
  /** The element under the pointer while targeting (null clears it). */
  onHover?: (id: string, rect: DomRect | null) => void
  onSelect: (id: string, shiftKey: boolean) => void
  onFocus?: (id: string | null) => void
  /**
   * A double-click opens the page elsewhere instead of entering Interact: a
   * Mockup opens in the file modal at 100% (#1885).
   */
  onOpen?: () => void
}) {
  const { id, elementAt } = page
  const tracking = (commentMode || pickActive) && !spaceHeld && !dimmed
  return (
    <>
      {dimmed && (
        <div className="pointer-events-none absolute inset-0 z-10 bg-background/60 transition-opacity" />
      )}
      {/* While interacting, the page takes the pointer instead. */}
      {!page.takesPointer && (
        <div
          data-live-page-overlay=""
          className="absolute inset-0 touch-none"
          style={{ cursor: "inherit" }}
          {...api.bodyDragHandlers}
          {...(tracking
            ? {
                // Hover-only: outline the element a click would target. The
                // click itself goes to the canvas's comment or pick handler,
                // which hit-tests again to capture the selector.
                onPointerMove: async (e: React.PointerEvent) => {
                  const hit = await elementAt(e.clientX, e.clientY)
                  onHover?.(id, hit ? hit.rect : null)
                },
                onPointerLeave: () => onHover?.(id, null),
              }
            : {})}
          onPointerDownCapture={api.onBodyPointerDownCapture}
          onDoubleClick={(e) => {
            if (
              !(onOpen || onFocus) ||
              !canInteractOnDoubleClick({
                hasPreview: hasPage,
                commentMode,
                // A dimmed page is ineligible for an armed pick, but the pick
                // still owns the pointer.
                pickActive: pickActive || dimmed,
                spaceHeld,
              })
            )
              return
            e.stopPropagation()
            // Interaction lives only while its layer is selected, so a
            // double-click on a member of a selected group narrows the
            // selection to this one first.
            onSelect(id, false)
            if (onOpen) onOpen()
            else onFocus?.(id)
          }}
        />
      )}
    </>
  )
}

/** The page's part of its layer's bar: Interact, Go live and Knobs. */
export function LivePageControls({
  page,
  focused,
  onFocus,
  askedForControl,
  controlRequests,
  onGrantControl,
  onDeclineControl,
  live = false,
  onToggleLive,
  liveUnavailable = false,
  liveStarting = false,
  onAskForKnob,
  theme,
}: {
  page: LivePage
  focused: boolean
  onFocus?: (id: string | null) => void
  /** This viewer asked the person driving for control (#1395). */
  askedForControl?: boolean
  /** People asking this viewer, the driver, for control (#1395). */
  controlRequests?: readonly FrameRequesterView[]
  onGrantControl?: (id: string, to: string) => void
  onDeclineControl?: (id: string, to: string) => void
  live?: boolean
  /** Go live or end it, for everyone; absent where the page can't go live. */
  onToggleLive?: () => void
  /** The page could go live but nothing can run it now (no Workspace is
   *  running): the toggle shows, disabled. */
  liveUnavailable?: boolean
  /** This viewer turned the page live and waits for its first picture
   *  (#1520): the toggle spins. */
  liveStarting?: boolean
  onAskForKnob?: () => void
  /** The Theme knob, on a shared page. */
  theme?: {
    value: FrameColorScheme
    onChange: (scheme: FrameColorScheme) => void
  }
}) {
  const { id, driver, record, writes } = page
  return (
    <>
      <FrameDriverButton
        driver={driver}
        asked={askedForControl}
        requests={controlRequests}
        onClick={() => onFocus?.(focused ? null : id)}
        onGrant={onGrantControl ? (to) => onGrantControl(id, to) : undefined}
        onDecline={
          onDeclineControl ? (to) => onDeclineControl(id, to) : undefined
        }
      />
      {onToggleLive && (
        <FrameGoLiveToggle
          live={live}
          pending={liveStarting}
          onToggle={onToggleLive}
          unavailable={liveUnavailable}
        />
      )}
      <KnobsPopover
        knobs={record.knobs}
        values={record.knobValues}
        onChange={(values) => writes?.knobValues(id, values)}
        onAskForKnob={onAskForKnob}
        theme={theme}
      />
    </>
  )
}

/**
 * The layer's title tag and whether its edges resize. Both answer to whoever
 * drives the page as this viewer sees it or, from an own copy of a live page,
 * whoever drives the live one: the layer's size is everyone's. Nobody resizes
 * a page they're interacting with (its edges belong to the page) or one
 * someone else drives (so the size never changes under them).
 */
export function livePageChrome({
  driver,
  focused,
  live = false,
  liveDriver,
  onLiveCopy = false,
}: {
  driver: FrameDriverView
  focused: boolean
  /** Someone turned the page live, for everyone (#1516). */
  live?: boolean
  /** Who drives the live copy. */
  liveDriver?: FrameDriverView
  /** This viewer sees the live copy (not their own). */
  onLiveCopy?: boolean
}): { titleTag: ReactNode; resizable: boolean } {
  const tagDriver =
    !drivenByOther(driver) && live && !onLiveCopy && liveDriver
      ? liveDriver
      : driver
  return {
    titleTag: drivenByOther(tagDriver) ? (
      <FrameDriverTag driver={tagDriver} />
    ) : live ? (
      <FrameLiveTag />
    ) : undefined,
    resizable: !focused && !drivenByOther(tagDriver),
  }
}
