"use client"

import { useMemo } from "react"
import type { RefObject } from "react"

import { iframeBridgePort, type BridgePort } from "@/lib/bridge-port"

/** The bridge port of an iframe the component renders. */
export function useIframeBridgePort(
  iframeRef: RefObject<HTMLIFrameElement | null>
): BridgePort {
  return useMemo(() => iframeBridgePort(iframeRef), [iframeRef])
}
