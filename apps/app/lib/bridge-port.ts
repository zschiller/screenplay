import type { RefObject } from "react"

import {
  isScreenplayMessage,
  type CanvasToIframeMessage,
  type IframeToCanvasMessage,
} from "@/lib/postmessage-protocol"

/**
 * How the canvas reaches a page's Sandbox Bridge. A local frame is an iframe
 * the canvas posts into; a Shared Frame (#1394) is a page in the Workspace's
 * Sandbox, reached over its Frame Stream. The bridge hooks
 * (`usePostMessage`, `useScreenplayDom`) speak the same messages either way.
 */
export interface BridgePort {
  /** Send the page a message. False when it can't be delivered now. */
  post(message: CanvasToIframeMessage): boolean
  /** Hear what the page posts to its parent. */
  subscribe(listener: (message: IframeToCanvasMessage) => void): () => void
}

/** The bridge in an iframe the canvas renders, over postMessage. */
export function iframeBridgePort(
  iframeRef: RefObject<HTMLIFrameElement | null>
): BridgePort {
  return {
    post(message) {
      const target = iframeRef.current?.contentWindow
      if (!target) return false
      target.postMessage(message, "*")
      return true
    },
    subscribe(listener) {
      const onMessage = (e: MessageEvent) => {
        if (!isScreenplayMessage(e.data)) return
        const target = iframeRef.current?.contentWindow
        if (!target || e.source !== target) return
        listener(e.data as IframeToCanvasMessage)
      }
      window.addEventListener("message", onMessage)
      return () => window.removeEventListener("message", onMessage)
    },
  }
}
