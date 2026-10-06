"use client"

import { useEffect, useRef } from "react"

import type {
  FrameStreamConnection,
  FrameStreamFrame,
} from "@/lib/frame-stream/client"
import {
  FRAME_STREAM_COLOR_SPACE,
  h264CodecOf,
  type FrameColorScheme,
  type FrameStreamServerMessage,
  type FrameStreamVideo,
} from "@/lib/frame-stream/protocol"

// The service's default device scale: a picture's CSS size until the
// frame's state says otherwise.
const SCALE = 2
const RESIZE_SETTLE_MS = 150
// Watch frames a little before they scroll into view.
const WATCH_MARGIN = "200px"

interface FrameStreamViewProps {
  /** The Workspace's stream, for its codec. */
  stream: FrameStreamConnection
  /** The frame's handle on it. */
  frame: FrameStreamFrame
  /** The frame's CSS size: the shared page's viewport. */
  width: number
  height: number
  /** The room's route, where the shared browser starts. */
  route: string
  /** The room's colour scheme for the page: the frame's Theme knob. */
  scheme: FrameColorScheme
  /** A Mockup's page (#1523): the shared browser shows it in place of the
   *  app, and shows each change to it. */
  doc?: string
  /** This viewer is in Interact on the frame: forward its input. */
  interactive: boolean
  /** Frame Control says this viewer drives the frame. */
  drives: boolean
  /** The shared page moved to `path`. `first` is the report on joining. */
  onRoute: (path: string, first: boolean) => void
  /** A picture is showing (or not, while the browser starts or restarts). */
  onLive: (live: boolean) => void
  /** This viewer's input went to the page: the driver isn't idle. */
  onActivity?: () => void
}

/**
 * A shared frame on a hosted canvas (#1392): the one browser running in the
 * Workspace's Sandbox, decoded from its Frame Stream with WebCodecs and drawn
 * into a canvas. Everyone watching sees the same picture. While this viewer
 * drives and interacts, its pointer, wheel and keys go to the page over the
 * stream; the service applies them only under a drive grant the app signed
 * for the driver, so nobody else's input reaches it.
 *
 * Only frames on screen in a visible tab are watched. The service pauses a
 * frame nobody watches (#1393); the canvas keeps its last picture meanwhile,
 * and the service sends that picture back first when watching resumes.
 */
export function FrameStreamView({
  stream,
  frame,
  width,
  height,
  route,
  scheme,
  doc,
  interactive,
  drives,
  onRoute,
  onLive,
  onActivity,
}: FrameStreamViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  // The CSS size the picture on show was captured at. While a resize waits
  // for the stream, the picture keeps this size, never stretched.
  const pictureSize = useRef({ width, height })
  /** A picture was drawn since the background was last read from it. */
  const pictureChanged = useRef(true)
  const latest = useRef({
    width,
    height,
    route,
    scheme,
    doc,
    onRoute,
    onLive,
    onActivity,
  })
  useEffect(() => {
    latest.current = {
      width,
      height,
      route,
      scheme,
      doc,
      onRoute,
      onLive,
      onActivity,
    }
  })

  // ---- watching and decoding ----

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Until a picture comes, the canvas covers the frame.
    if (!canvas.style.width) {
      canvas.style.width = `${pictureSize.current.width}px`
      canvas.style.height = `${pictureSize.current.height}px`
    }
    let decoder: VideoDecoder | null = null
    let configured: string | null = null
    let waitingForKey = true
    let timestamp = 0
    let live = false
    let firstRoute = true
    let videoSize = { width: 0, height: 0 }
    // Each encoded size's CSS size, from the frame's state messages: the
    // service lowers the scale for a frame past its pixel budget.
    const cssSizes = new Map<string, { width: number; height: number }>()
    let unwatch: (() => void) | null = null

    const setLive = (next: boolean) => {
      if (live === next) return
      live = next
      latest.current.onLive(next)
    }

    const resetDecoder = () => {
      waitingForKey = true
      configured = null
      if (decoder && decoder.state !== "closed") decoder.close()
      decoder = null
    }

    const draw = (picture: VideoFrame) => {
      const resized =
        canvas.width !== picture.displayWidth ||
        canvas.height !== picture.displayHeight
      if (resized) {
        canvas.width = picture.displayWidth
        canvas.height = picture.displayHeight
        const css = cssSizes.get(
          `${picture.displayWidth}x${picture.displayHeight}`
        ) ?? {
          width: picture.displayWidth / SCALE,
          height: picture.displayHeight / SCALE,
        }
        pictureSize.current = css
        canvas.style.width = `${css.width}px`
        canvas.style.height = `${css.height}px`
      }
      canvas.getContext("2d")?.drawImage(picture, 0, 0)
      pictureChanged.current = true
      picture.close()
      setLive(true)
    }

    const onVideo = (video: FrameStreamVideo) => {
      if (typeof VideoDecoder === "undefined") return
      if (waitingForKey && !video.key) return
      if (video.key) {
        const codec = stream.codec === "h264" ? h264CodecOf(video.data) : "vp8"
        if (!codec) return
        if (!decoder || decoder.state === "closed") {
          decoder = new VideoDecoder({
            output: draw,
            error: () => resetDecoder(),
          })
          configured = null
        }
        if (codec !== configured) {
          decoder.configure({
            codec,
            optimizeForLatency: true,
            colorSpace: FRAME_STREAM_COLOR_SPACE,
          })
          configured = codec
        }
        waitingForKey = false
      }
      if (!decoder || decoder.state !== "configured") return
      // A viewer that can't keep up skips ahead to the next keyframe.
      if (decoder.decodeQueueSize > 30) {
        resetDecoder()
        return
      }
      decoder.decode(
        new EncodedVideoChunk({
          type: video.key ? "key" : "delta",
          timestamp: (timestamp += 1000),
          data: video.data,
        })
      )
    }

    const onMessage = (msg: FrameStreamServerMessage) => {
      if (msg.t === "frame") {
        if (msg.status !== "live") {
          setLive(false)
          resetDecoder()
        }
        cssSizes.set(`${msg.videoWidth}x${msg.videoHeight}`, {
          width: msg.width,
          height: msg.height,
        })
        if (
          msg.videoWidth !== videoSize.width ||
          msg.videoHeight !== videoSize.height
        ) {
          videoSize = { width: msg.videoWidth, height: msg.videoHeight }
          resetDecoder()
        }
      } else if (msg.t === "route") {
        latest.current.onRoute(msg.path, firstRoute)
        firstRoute = false
      }
    }

    const watch = () => {
      if (unwatch) return
      const { route, width, height, scheme, doc } = latest.current
      firstRoute = true
      unwatch = frame.watch(
        { route, width, height, scheme, ...(doc === undefined ? {} : { doc }) },
        {
          onMessage,
          onVideo,
          onConnection: (ready) => {
            if (!ready) setLive(false)
            resetDecoder()
          },
        }
      )
    }
    const stop = () => {
      unwatch?.()
      unwatch = null
      resetDecoder()
    }

    let onScreen = false
    const update = () =>
      onScreen && document.visibilityState === "visible" ? watch() : stop()
    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = !!entry?.isIntersecting
        update()
      },
      { rootMargin: WATCH_MARGIN }
    )
    observer.observe(canvas)
    document.addEventListener("visibilitychange", update)
    return () => {
      observer.disconnect()
      document.removeEventListener("visibilitychange", update)
      stop()
    }
  }, [stream, frame])

  // Room the picture doesn't cover yet, while the frame grows ahead of the
  // stream, shows the page's own background: its bottom-right pixel. Read
  // once per picture: a read waits on the GPU, and a resize drag changes the
  // size on every step while the picture stays put.
  useEffect(() => {
    const canvas = canvasRef.current
    const box = boxRef.current
    if (!canvas?.width || !box || !pictureChanged.current) return
    pictureChanged.current = false
    const [r, g, b, a] = canvas
      .getContext("2d")!
      .getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data
    if (a) box.style.backgroundColor = `rgb(${r}, ${g}, ${b})`
  }, [width, height])

  // The frame's size and the room's route follow the layer. A resize drag
  // settles first: each new size restarts the frame's encoder.
  useEffect(() => {
    const id = setTimeout(
      () => frame.update({ width, height }),
      RESIZE_SETTLE_MS
    )
    return () => clearTimeout(id)
  }, [frame, width, height])
  useEffect(() => {
    frame.update({ route })
  }, [frame, route])
  useEffect(() => {
    frame.update({ scheme })
  }, [frame, scheme])
  useEffect(() => {
    if (doc !== undefined) frame.update({ doc })
  }, [frame, doc])

  // ---- driving ----

  // The handle asks for the grant and keeps it fresh while this viewer drives.
  useEffect(() => {
    if (!drives) return
    return frame.drive()
  }, [drives, frame])

  const active = interactive && drives

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !active) return
    const input = frame.input(() => ({
      rect: canvas.getBoundingClientRect(),
      ...pictureSize.current,
    }))
    const mouse =
      (type: "mousePressed" | "mouseReleased" | "mouseMoved") =>
      (e: PointerEvent) => {
        if (type === "mousePressed") {
          canvas.focus({ preventScroll: true })
          canvas.setPointerCapture(e.pointerId)
        }
        input.pointer(type, e)
        latest.current.onActivity?.()
      }
    const onDown = mouse("mousePressed")
    const onMove = mouse("mouseMoved")
    const onUp = mouse("mouseReleased")
    const onWheel = (e: WheelEvent) => {
      input.wheel(e)
      latest.current.onActivity?.()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      input.key("keyDown", e)
      latest.current.onActivity?.()
    }
    const onKeyUp = (e: KeyboardEvent) => input.key("keyUp", e)
    const onPaste = (e: ClipboardEvent) => input.paste(e)
    // What the page copies lands on this viewer's clipboard. The text comes
    // back over the stream, so it's written as a promise that ClipboardItem
    // holds within the keypress; an empty copy leaves the clipboard alone.
    const onCopy = (e: ClipboardEvent) => {
      const text = input.copy(e)
      const blob = text.then((t) => {
        if (!t) throw new Error("nothing copied")
        return new Blob([t], { type: "text/plain" })
      })
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        navigator.clipboard
          .write([new ClipboardItem({ "text/plain": blob })])
          .catch(() => {})
      } else {
        void text
          .then((t) => (t ? navigator.clipboard?.writeText(t) : undefined))
          .catch(() => {})
      }
    }
    const onContextMenu = (e: Event) => e.preventDefault()

    canvas.addEventListener("pointerdown", onDown)
    canvas.addEventListener("pointermove", onMove)
    canvas.addEventListener("pointerup", onUp)
    canvas.addEventListener("wheel", onWheel, { passive: false })
    canvas.addEventListener("keydown", onKeyDown)
    canvas.addEventListener("keyup", onKeyUp)
    canvas.addEventListener("paste", onPaste)
    canvas.addEventListener("copy", onCopy)
    canvas.addEventListener("cut", onCopy)
    canvas.addEventListener("contextmenu", onContextMenu)
    canvas.focus({ preventScroll: true })
    return () => {
      canvas.removeEventListener("pointerdown", onDown)
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerup", onUp)
      canvas.removeEventListener("wheel", onWheel)
      canvas.removeEventListener("keydown", onKeyDown)
      canvas.removeEventListener("keyup", onKeyUp)
      canvas.removeEventListener("paste", onPaste)
      canvas.removeEventListener("copy", onCopy)
      canvas.removeEventListener("cut", onCopy)
      canvas.removeEventListener("contextmenu", onContextMenu)
      if (document.activeElement === canvas) canvas.blur()
    }
  }, [active, frame])

  // The picture sits at its own size, top left: a resize crops it or shows
  // the page's background beside it until the stream catches up.
  return (
    <div
      ref={boxRef}
      className="absolute inset-0 overflow-hidden bg-white dark:bg-neutral-900"
    >
      <canvas
        ref={canvasRef}
        tabIndex={active ? 0 : -1}
        data-frame-stream=""
        className="absolute top-0 left-0 outline-none"
        style={{ pointerEvents: interactive ? "auto" : "none" }}
      />
    </div>
  )
}
