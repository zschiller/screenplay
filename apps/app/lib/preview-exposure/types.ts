/**
 * **Preview exposure**: how a browser reaches a Workspace's preview on a
 * machine Screenplay runs on (the Mac app, a Headless box). A fork swaps it
 * in `selectPreviewExposure`. Every member is a compatibility promise, so it
 * stays this small.
 *
 * Only browser-facing listeners go through it: the bridge proxy a frame
 * loads, and the frame stream. Every listener binds 127.0.0.1, and everything
 * the server reads (probes, thumbnails, agent page reads) stays there; an
 * exposure forwards a port from there.
 */
export interface PreviewExposure {
  /**
   * Make `port` reachable for browsers, once its listener is started.
   * Idempotent: called again after a restart or a reconnect with the same
   * port. Throws with a message for the preview's error state.
   */
  expose(port: number): Promise<ExposedPort>

  /**
   * Undo {@link expose} when the listener goes away (its Workspace was
   * deleted). Idempotent and best-effort: never throws.
   */
  release(port: number): Promise<void>
}

export interface ExposedPort {
  /** What a browser loads, origin only, no trailing slash: "https://box.tailnet.ts.net:5123". */
  browserOrigin: string
}
