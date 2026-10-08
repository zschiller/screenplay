import "server-only"

import { backendSwitch } from "@/lib/capabilities"
import { loopbackExposure } from "@/lib/preview-exposure/builtins"
import type { PreviewExposure } from "@/lib/preview-exposure/types"

export {
  commandExposure,
  loopbackExposure,
  previewExposureOptions,
  urlTemplateExposure,
} from "@/lib/preview-exposure/builtins"
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
 * `loopback`, every profile's default. `url-template` and `command` need
 * options, so a fork that wants one (or its own) changes this function. Throws
 * on an id it doesn't know.
 */
export function selectPreviewExposure(
  env: Record<string, string | undefined> = process.env
): PreviewExposure {
  const id = backendSwitch("PREVIEW_EXPOSURE", env) ?? "loopback"
  if (id === "loopback") return loopbackExposure()
  throw new Error(`PREVIEW_EXPOSURE "${id}" isn’t known (known: loopback)`)
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
