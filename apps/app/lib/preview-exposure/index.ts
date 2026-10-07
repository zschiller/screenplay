import "server-only"

import { loopbackExposure } from "@/lib/preview-exposure/builtins"
import type { PreviewExposure } from "@/lib/preview-exposure/types"

export {
  commandExposure,
  createPreviewExposure,
  loopbackExposure,
  previewExposureOptions,
  urlTemplateExposure,
} from "@/lib/preview-exposure/builtins"
export type {
  PreviewExposureConfig,
  PreviewExposureId,
  PreviewExposureOptions,
} from "@/lib/preview-exposure/builtins"
export type {
  ExposedPort,
  PortRange,
  PreviewExposure,
} from "@/lib/preview-exposure/types"

/**
 * One per process, on `globalThis` so every server bundle Next builds (route
 * handlers, server actions, instrumentation) sees the same one.
 */
const KEY = Symbol.for("screenplay.previewExposure")
type Host = { [KEY]?: PreviewExposure }

/**
 * The preview exposure this server runs with: whatever the config picked at
 * start ({@link setPreviewExposure}), else `loopback`, the Mac app's.
 */
export function getPreviewExposure(): PreviewExposure {
  return ((globalThis as Host)[KEY] ??= loopbackExposure())
}

/** Pick the preview exposure, once, as the server starts. */
export function setPreviewExposure(exposure: PreviewExposure): void {
  ;(globalThis as Host)[KEY] = exposure
}
