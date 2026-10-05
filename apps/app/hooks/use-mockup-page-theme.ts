"use client"

import { useEffect, useRef } from "react"
import type { BridgePort } from "@/lib/bridge-port"

/**
 * Tells a Mockup page which theme the app is in (`screenplay.theme()`), when
 * it asks and on every change, so a page can match the app rather than the
 * system. Null says nothing: a live page is one page everyone sees, in the
 * theme the Mockup's own control sets.
 */
export function useMockupPageTheme(
  port: BridgePort,
  scheme: "light" | "dark" | null
): void {
  const latest = useRef(scheme)
  useEffect(() => {
    latest.current = scheme
    if (scheme) port.post({ type: "screenplay:theme-apply", scheme })
  }, [port, scheme])

  useEffect(
    () =>
      port.subscribe((data) => {
        const now = latest.current
        if (data.type === "screenplay:theme-request" && now) {
          port.post({ type: "screenplay:theme-apply", scheme: now })
        }
      }),
    [port]
  )
}
