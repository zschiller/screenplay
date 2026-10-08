"use client"

import { useEffect, useState } from "react"
import type { WebsocketProvider } from "y-websocket"
import { Spinner } from "@workspace/ui/components/spinner"

import { ViewerScreen } from "@/components/viewer/refused-screen"
import {
  type HostAway,
  hostAwayMessage,
  nextHostAway,
} from "@/lib/viewer/host-away"

/** How long a dropped socket may take to come back before the viewer is told. */
const UNREACHABLE_AFTER_MS = 2_000

/**
 * What a viewer sees while the host is away (Sharing, #1953): the refused
 * page's screen over the canvas, saying the host stopped sharing or their
 * Mac can't be reached. The canvas stays loaded underneath, and the screen
 * goes as soon as the canvas socket connects again. Picked in the #1953
 * exploration (option B).
 */
export function HostAwayScreen({ provider }: { provider: WebsocketProvider }) {
  const [away, setAway] = useState<HostAway>(null)
  // Whether a dropped socket has stayed down long enough to say so; reset
  // whenever `away` changes (the previous-value pattern, not an effect).
  const [late, setLate] = useState(false)
  const [lateFor, setLateFor] = useState<HostAway>(null)
  if (away !== lateFor) {
    setLateFor(away)
    setLate(false)
  }
  const [host, setHost] = useState<string | null>(null)

  useEffect(() => {
    const onStatus = ({ status }: { status: string }) => {
      if (
        status === "connected" ||
        status === "connecting" ||
        status === "disconnected"
      ) {
        setAway((prev) => nextHostAway(prev, { type: "status", status }))
      }
    }
    const onClose = (event: CloseEvent | null) => {
      setAway((prev) =>
        nextHostAway(prev, { type: "close", code: event?.code })
      )
    }
    // The host is the one present who isn't a viewer; remember their name
    // for when they're gone.
    const onAwareness = () => {
      const self = provider.awareness.clientID
      for (const [clientId, state] of provider.awareness.getStates()) {
        // This page's own presence carries no server stamp yet.
        if (clientId === self) continue
        const presence = state as {
          viewer?: boolean
          identity?: { name?: string }
        }
        if (presence.viewer !== true && presence.identity?.name) {
          setHost(presence.identity.name)
          return
        }
      }
    }
    provider.on("status", onStatus)
    provider.on("connection-close", onClose)
    provider.awareness.on("change", onAwareness)
    onAwareness()
    return () => {
      provider.off("status", onStatus)
      provider.off("connection-close", onClose)
      provider.awareness.off("change", onAwareness)
    }
  }, [provider])

  // "Stopped" shows at once; a dropped socket gets a moment to come back.
  useEffect(() => {
    if (away !== "unreachable") return
    const timer = setTimeout(() => setLate(true), UNREACHABLE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [away])

  const shown = away === "unreachable" && !late ? null : away
  if (!shown) return null
  return (
    <ViewerScreen
      className="fixed inset-0 z-60"
      below={
        shown === "unreachable" ? (
          <Spinner className="size-4 text-muted-foreground" />
        ) : null
      }
    >
      {hostAwayMessage(shown, host)}
    </ViewerScreen>
  )
}
