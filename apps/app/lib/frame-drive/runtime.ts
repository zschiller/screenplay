import { sharedFramesEnabled } from "@/lib/frame-stream/shared-frames"
import { isLocalBuild } from "@/lib/local-mode"
import { isLocalSandboxBackend } from "@/lib/sandbox/backend"

/**
 * How the agent drives frames here, which decides its Frame Drive backends
 * and prompt: the frame in your own canvas in the desktop app (`mac`, #1389),
 * a frame's one shared browser on hosted (`shared`, #1396), or not at all (a
 * hosted deployment without shared frames, where it drives Mockups only).
 * Mockups are driven in the asker's own view everywhere (#1391).
 */
export type FrameDriveRuntime = "mac" | "shared" | null

export function frameDriveRuntime(): FrameDriveRuntime {
  if (isLocalBuild) return "mac"
  if (isLocalSandboxBackend() || !sharedFramesEnabled()) return null
  return "shared"
}
