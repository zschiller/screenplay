import "server-only"

import { existsSync } from "node:fs"

import { backendSwitch } from "@/lib/capabilities"
import {
  TAILSCALE_ID,
  tailscaleIdentity,
} from "@/lib/viewer-identity/tailscale"
import type { ViewerIdentity } from "@/lib/viewer-identity/types"

export type {
  ViewerAnswer,
  ViewerIdentity,
  ViewerPerson,
  ViewerRequest,
} from "@/lib/viewer-identity/types"

/** Where the Mac's Tailscale app keeps its CLI when it isn't on PATH. */
const MAC_TAILSCALE_CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale"

/**
 * Pick this server's viewer identity: `VIEWER_IDENTITY` when set, else
 * `tailscale`, the Mac app's. A fork that identifies viewers another way
 * changes this function. Throws on an id it doesn't know. Returns the id too,
 * which namespaces person ids, so switching makes new people.
 */
export function selectViewerIdentity(
  env: Record<string, string | undefined> = process.env
): { id: string; identity: ViewerIdentity } {
  const id = backendSwitch("VIEWER_IDENTITY", env) ?? TAILSCALE_ID
  if (id === TAILSCALE_ID) {
    return {
      id,
      identity: tailscaleIdentity({
        command: existsSync(MAC_TAILSCALE_CLI) ? MAC_TAILSCALE_CLI : undefined,
      }),
    }
  }
  throw new Error(
    `VIEWER_IDENTITY "${id}" isn’t known (known: ${TAILSCALE_ID})`
  )
}
