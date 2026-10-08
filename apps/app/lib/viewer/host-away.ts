import { SHARING_OFF_CLOSE_CODE } from "@/server/ws-routes.mjs"

/**
 * Why a viewer's canvas has lost its host (Sharing, #1953), or null while
 * it's connected:
 *
 * - **stopped**: the host turned Sharing off. The server closes the canvas
 *   socket with Sharing's off code first, so the page knows. It stays
 *   stopped through the failed reconnects that follow, until one succeeds.
 * - **unreachable**: the socket dropped any other way, as when the Mac
 *   sleeps or leaves the network.
 */
export type HostAway = "stopped" | "unreachable" | null

/** What the canvas socket reports. */
export type SocketEvent =
  | { type: "status"; status: "connected" | "connecting" | "disconnected" }
  | { type: "close"; code: number | undefined }

export function nextHostAway(away: HostAway, event: SocketEvent): HostAway {
  if (event.type === "close") {
    return event.code === SHARING_OFF_CLOSE_CODE
      ? "stopped"
      : (away ?? "unreachable")
  }
  if (event.status === "connected") return null
  if (event.status === "disconnected") return away ?? "unreachable"
  return away
}

/** The line a viewer reads while the host is away. */
export function hostAwayMessage(
  away: "stopped" | "unreachable",
  host: string | null
): string {
  if (away === "stopped") {
    return `${host ?? "The host"} stopped sharing. This page comes back when they share again.`
  }
  return host
    ? `Can’t reach ${host}’s Mac. Trying again…`
    : "Can’t reach the host’s Mac. Trying again…"
}
