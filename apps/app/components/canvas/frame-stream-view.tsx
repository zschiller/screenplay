"use client"

import { useEffect, useRef } from "react"

import {
  fetchDriveToken,
  type FrameStreamConnection,
} from "@/lib/frame-stream/client"
import {
  FRAME_STREAM_COLOR_SPACE,
  clickCounter,
  h264CodecOf,
  modifiersOf,
  mouseButtonOf,
  pageKeyOf,
  type FrameColorScheme,
  type FrameStreamInput,
  type FrameStreamServerMessage,
  type FrameStreamVideo,
} from "@/lib/frame-stream/protocol"

// A drive grant lasts a minute; ask for the next one well before.
const DRIVE_REFRESH_MS = 30_000
// Frame Control's record can reach the server a moment after this viewer
// wrote it, so a refused grant is asked for again a few times.
const DRIVE_RETRY_MS = [0, 300, 800, 2000]
// The service's default device scale: a picture's CSS size until the
// frame's state says otherwise.
const SCALE = 2
const RESIZE_SETTLE_MS = 150
// Watch frames a little before they scroll into view.
const WATCH_MARGIN = "200px"

interface FrameStreamViewProps {
  stream: FrameStreamConnection
  roomId: string
  frameId: string
  /** The frame's CSS size: the shared page's viewport. */
  width: number
  height: number
  /** The room's route, where the shared browser starts. */
  route: string
  /** The room's colour scheme for the page: the frame's Theme knob. */
  scheme: FrameColorScheme
  /** This viewer is in Interact on the frame: forward its input. */
  interactive: boolean
  /** Frame Control says this viewer drives the frame. */
  drives: boolean
  /** The shared page moved to `path`. `first` is the report on joining. */
  onRoute: (path: string, first: boolean) => void
  /** A picture is showing (or not, while the browser starts or restarts). */
  onLive: (live: boolean) => void
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
  roomId,
  frameId,
  width,
  height,
  route,
  scheme,
  interactive,
  drives,
  onRoute,
  onLive,
}: FrameStreamViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  // The CSS size the picture on show was captured at. While a resize waits
  // for the stream, the picture keeps this size, never stretched.
  const pictureSize = useRef({ width, height })
  const latest = useRef({ width, height, route, scheme, onRoute, onLive })
  useEffect(() => {
    latest.current = { width, height, route, scheme, onRoute, onLive }
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
      const { route, width, height, scheme } = latest.current
      firstRoute = true
      unwatch = stream.watch(
        frameId,
        { route, width, height, scheme },
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
  }, [stream, frameId])

  // Room the picture doesn't cover yet, while the frame grows ahead of the
  // stream, shows the page's own background: its bottom-right pixel.
  useEffect(() => {
    const canvas = canvasRef.current
    const box = boxRef.current
    if (!canvas?.width || !box) return
    const [r, g, b, a] = canvas
      .getContext("2d")!
      .getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data
    if (a) box.style.backgroundColor = `rgb(${r}, ${g}, ${b})`
  }, [width, height])

  // The frame's size and the room's route follow the layer. A resize drag
  // settles first: each new size restarts the frame's encoder.
  useEffect(() => {
    const id = setTimeout(
      () => stream.update(frameId, { width, height }),
      RESIZE_SETTLE_MS
    )
    return () => clearTimeout(id)
  }, [stream, frameId, width, height])
  useEffect(() => {
    stream.update(frameId, { route })
  }, [stream, frameId, route])
  useEffect(() => {
    stream.update(frameId, { scheme })
  }, [stream, frameId, scheme])

  // ---- driving ----

  useEffect(() => {
    if (!drives) return
    let run = 0
    let refresh: ReturnType<typeof setTimeout> | null = null
    // Each run supersedes the one before (a reconnect starts a new one).
    const grant = async () => {
      const mine = ++run
      if (refresh) clearTimeout(refresh)
      const current = () => mine === run
      // The grant rides the stream, so wait for it to be up.
      while (!stream.isReady()) {
        await new Promise((r) => setTimeout(r, 250))
        if (!current()) return
      }
      for (const wait of DRIVE_RETRY_MS) {
        if (wait) await new Promise((r) => setTimeout(r, wait))
        if (!current()) return
        const token = await fetchDriveToken(roomId, frameId).catch(() => null)
        if (!current()) return
        // The stream sends it again whenever this view watches the frame
        // again (a hidden tab, a frame scrolled away).
        if (token && stream.isReady()) {
          stream.drive(frameId, token)
          break
        }
      }
      refresh = setTimeout(() => void grant(), DRIVE_REFRESH_MS)
    }
    void grant()
    // A reconnect may have outlasted the grant: ask again.
    const unsubscribe = stream.subscribeConnection((ready) => {
      if (ready) void grant()
    })
    // A hidden tab's timers may not have kept the grant fresh: ask again
    // when it shows.
    const onVisible = () => {
      if (document.visibilityState === "visible") void grant()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      run++
      unsubscribe()
      document.removeEventListener("visibilitychange", onVisible)
      if (refresh) clearTimeout(refresh)
      stream.release(frameId)
    }
  }, [drives, stream, roomId, frameId])

  const active = interactive && drives

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !active) return
    const send = (input: FrameStreamInput) =>
      stream.send({ t: "input", frame: frameId, ...input })
    // Client pixels to the page's CSS pixels: the canvas is drawn at the
    // picture's size inside the zoomed world.
    const at = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const { width, height } = pictureSize.current
      return {
        x: ((e.clientX - rect.left) * width) / rect.width,
        y: ((e.clientY - rect.top) * height) / rect.height,
      }
    }
    const countClick = clickCounter()
    let clickCount = 1
    const mouse =
      (type: "mousePressed" | "mouseReleased" | "mouseMoved") =>
      (e: PointerEvent) => {
        if (type === "mousePressed") {
          canvas.focus({ preventScroll: true })
          canvas.setPointerCapture(e.pointerId)
          clickCount = countClick(e.button, e.clientX, e.clientY, e.timeStamp)
        }
        send({
          kind: "mouse",
          type,
          ...at(e),
          button: type === "mouseMoved" ? "none" : mouseButtonOf(e.button),
          buttons: e.buttons,
          clickCount: type === "mouseMoved" ? 0 : clickCount,
          modifiers: modifiersOf(e),
        })
      }
    const onDown = mouse("mousePressed")
    const onMove = mouse("mouseMoved")
    const onUp = mouse("mouseReleased")
    const onWheel = (e: WheelEvent) => {
      // Cmd/Ctrl+wheel still zooms the canvas.
      if (e.ctrlKey || e.metaKey) return
      e.preventDefault()
      e.stopPropagation()
      send({
        kind: "wheel",
        ...at(e),
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        modifiers: modifiersOf(e),
      })
    }
    const mac = /Mac|iPhone|iPad/.test(navigator.platform)
    const key = (type: "keyDown" | "keyUp") => (e: KeyboardEvent) => {
      // Keys belong to the page, not the canvas's shortcuts. Esc goes to
      // both: the page sees it, and the canvas leaves Interact.
      if (e.key !== "Escape") e.stopPropagation()
      // Paste goes as the paste event, with this viewer's clipboard: the
      // shortcut itself would paste the shared browser's.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === "KeyV") return
      if (e.key !== "Escape") e.preventDefault()
      if (e.isComposing) return
      const text =
        type === "keyDown" && !e.metaKey && !e.ctrlKey
          ? e.key === "Enter"
            ? "\r"
            : e.key.length === 1
              ? e.key
              : undefined
          : undefined
      send({
        kind: "key",
        type: type === "keyDown" && !text ? "rawKeyDown" : type,
        ...pageKeyOf(e, mac),
        text,
        repeat: e.repeat,
      })
    }
    const onKeyDown = key("keyDown")
    const onKeyUp = key("keyUp")
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain")
      if (!text) return
      e.preventDefault()
      send({ kind: "text", text })
    }
    const onContextMenu = (e: Event) => e.preventDefault()

    canvas.addEventListener("pointerdown", onDown)
    canvas.addEventListener("pointermove", onMove)
    canvas.addEventListener("pointerup", onUp)
    canvas.addEventListener("wheel", onWheel, { passive: false })
    canvas.addEventListener("keydown", onKeyDown)
    canvas.addEventListener("keyup", onKeyUp)
    canvas.addEventListener("paste", onPaste)
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
      canvas.removeEventListener("contextmenu", onContextMenu)
      if (document.activeElement === canvas) canvas.blur()
    }
  }, [active, stream, frameId])

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
