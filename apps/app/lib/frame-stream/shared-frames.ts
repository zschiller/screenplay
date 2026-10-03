/**
 * Shared frames are on for hosted Workspaces unless the deployment turns them
 * off with `SHARED_FRAMES=off`. The desktop app keeps its local iframes.
 */
export function sharedFramesEnabled(): boolean {
  return process.env.SHARED_FRAMES?.trim().toLowerCase() !== "off"
}
