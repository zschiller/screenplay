import "server-only"

import { backendSwitch } from "@/lib/capabilities"
import { loopbackExposure } from "@/lib/preview-exposure/builtins"
import { tailscaleExposure } from "@/lib/preview-exposure/tailscale"
import type { PreviewExposure } from "@/lib/preview-exposure/types"

export {
  commandExposure,
  loopbackExposure,
  previewExposureOptions,
  urlTemplateExposure,
} from "@/lib/preview-exposure/builtins"
export { tailscaleExposure } from "@/lib/preview-exposure/tailscale"
export type { TailscaleExposureOptions } from "@/lib/preview-exposure/tailscale"
export type {
  PreviewExposureId,
  PreviewExposureOptions,
} from "@/lib/preview-exposure/builtins"
export type {
  ExposedPort,
  PortRange,
  PreviewExposure,
} from "@/lib/preview-exposure/types"

/**
 * Pick this server's preview exposure: `PREVIEW_EXPOSURE` when set, else
 * `loopback`, every profile's default. `tailscale` serves each port over the
 * Mac's tailnet name (Sharing). `url-template` and `command` need options, so
 * a fork that wants one (or its own) changes this function. Throws on an id it
 * doesn't know.
 */
export function selectPreviewExposure(
  env: Record<string, string | undefined> = process.env
): PreviewExposure {
  const id = backendSwitch("PREVIEW_EXPOSURE", env) ?? "loopback"
  if (id === "loopback") return loopbackExposure()
  if (id === "tailscale") return tailscaleExposure()
  throw new Error(
    `PREVIEW_EXPOSURE "${id}" isn’t known (known: loopback, tailscale)`
  )
}

/**
 * One per process, on `globalThis` so every server bundle Next builds (route
 * handlers, server actions, instrumentation) sees the same one.
 */
const KEY = Symbol.for("screenplay.previewExposure")
type Host = { [KEY]?: PreviewExposure }

/** The preview exposure this server runs with, picked on first use. */
export function getPreviewExposure(): PreviewExposure {
  return ((globalThis as Host)[KEY] ??= selectPreviewExposure())
}
