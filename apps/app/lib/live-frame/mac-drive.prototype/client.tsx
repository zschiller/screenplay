"use client"

// PROTOTYPE (#1367) — throwaway. The canvas-client half of the Mac drive relay:
// watches the server's awareness state for an op, forwards it to the named
// frame's iframe with postMessage, and POSTs the bridge's answer back.
import { useEffect } from "react"
import type { RefObject } from "react"

import { useYjs } from "@/lib/yjs/context"

type FrameEntry = { iframeRef: RefObject<HTMLIFrameElement | null>; zoom: () => number }
const frames = new Map<string, FrameEntry>()

/** Called by each IframeLayer so the relay can find its iframe by layer id. */
export function useRegisterDriveFrame(
  id: string,
  iframeRef: RefObject<HTMLIFrameElement | null>,
  zoom: number
) {
  useEffect(() => {
    const entry: FrameEntry = { iframeRef, zoom: () => zoom }
    frames.set(id, entry)
    return () => {
      if (frames.get(id) === entry) frames.delete(id)
    }
  }, [id, iframeRef, zoom])
}

type DriveOp = {
  id: string
  frameId: string
  message: Record<string, unknown>
  tPublish: number
}

function askBridge(
  iframe: HTMLIFrameElement,
  id: string,
  message: Record<string, unknown>
): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage)
      resolve({ ok: false, error: "bridge timeout (stale bridge in the frame?)" })
    }, 6000)
    function onMessage(e: MessageEvent) {
      if (e.source !== iframe.contentWindow) return
      const d = e.data
      if (!d || d.type !== "screenplay:dom-result" || d.id !== id) return
      clearTimeout(timer)
      window.removeEventListener("message", onMessage)
      resolve({ ok: d.ok, value: d.value, error: d.error })
    }
    window.addEventListener("message", onMessage)
    iframe.contentWindow!.postMessage({ ...message, id }, "*")
  })
}

export function MacDriveRelay() {
  const { awareness, roomId } = useYjs()

  useEffect(() => {
    const seen = new Set<string>()
    async function run(op: DriveOp) {
      const tClient = Date.now()
      let result: { ok: boolean; value?: unknown; error?: string }
      const frame = frames.get(String(op.message.frameId ?? op.frameId))
      const iframe = frame?.iframeRef.current
      if (op.frameId === "__client") {
        if (op.message.frameId === "__window") {
          // The whole webview, for looking at the canvas itself.
          result = {
            ok: true,
            value: {
              rect: null,
              zoom: 1,
              window: { width: innerWidth, height: innerHeight },
              visibility: document.visibilityState,
              focused: document.hasFocus(),
              frames: [...frames.keys()],
            },
          }
        } else if (!iframe) result = { ok: false, error: "frame isn't mounted in this canvas" }
        else {
          const r = iframe.getBoundingClientRect()
          result = {
            ok: true,
            value: {
              rect: { x: r.x, y: r.y, width: r.width, height: r.height },
              zoom: frame!.zoom(),
              window: { width: innerWidth, height: innerHeight },
              visibility: document.visibilityState,
              focused: document.hasFocus(),
              frames: [...frames.keys()],
            },
          }
        }
      } else if (!iframe?.contentWindow) {
        result = {
          ok: false,
          error: `frame ${op.frameId} isn't mounted here (have: ${[...frames.keys()].join(", ")})`,
        }
      } else {
        result = await askBridge(iframe, "drv_" + op.id, op.message)
      }
      await fetch("/api/prototype/mac-drive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "answer",
          roomId,
          id: op.id,
          result: {
            ...result,
            client: { tClient, tClientDone: Date.now(), visibility: document.visibilityState },
          },
        }),
      })
    }
    function onUpdate() {
      awareness.getStates().forEach((state) => {
        const op = (state as { macDrive?: DriveOp } | null)?.macDrive
        if (!op || seen.has(op.id)) return
        seen.add(op.id)
        void run(op)
      })
    }
    awareness.on("update", onUpdate)
    return () => awareness.off("update", onUpdate)
  }, [awareness, roomId])

  return null
}
