/**
 * How a fixture Workspace's frames are addressed on the fixture preview server.
 *
 * Its own module, dependency-free, because both ends need it: the Fixture World
 * (which writes each Branch's `previewDomain`) and the preview server (which
 * routes on the path). Keeping it out of `./preview-server.ts` means the world —
 * plain data — doesn't transitively import a module that reads the Sandbox
 * Bridge off disk at import time.
 */

/** Path prefix each Workspace's frames are served under (`/w/<sandboxName>/…`). */
export const PREVIEW_WORKSPACE_PREFIX = "/w"

/**
 * Workspaces whose sandbox name starts with this never get a dev server: every
 * request answers with the proxy's placeholder. It is how the Fixture World puts
 * a frame in front of a Workspace that is booting, starting, failed, or stopped
 * (issue #731) without the frame loading a page behind the status screen.
 */
export const COLD_WORKSPACE_PREFIX = "cold-"

/**
 * Build the `previewDomain` for a Workspace. The canvas concatenates
 * `previewDomain + route` to get a frame's `src`, so the per-Workspace part has
 * to be a path prefix the server can route on — and the sandbox name is the
 * readable half, which the fixture page then shows as its brand.
 */
export function previewDomainFor(origin: string, sandboxName: string): string {
  return `${origin}${PREVIEW_WORKSPACE_PREFIX}/${sandboxName}`
}
