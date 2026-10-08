/**
 * **Preview exposure**: how a browser reaches a Workspace's preview on a
 * machine Screenplay runs on (the Mac app, a Headless box). A fork swaps it
 * in `selectPreviewExposure`. Every member is a compatibility promise, so it
 * stays this small.
 *
 * Only browser-facing listeners go through it: the bridge proxy a frame
 * loads, and the frame stream. The dev server itself, and everything the
 * server reads (probes, thumbnails, agent page reads), stay on 127.0.0.1.
 */
export interface PreviewExposure {
  /**
   * Where browser-facing preview listeners bind, and which ports they may
   * take.
   *
   * - `host`: "127.0.0.1" when something on this machine forwards them (the
   *   Mac app, an SSH tunnel, `tailscale serve`); "0.0.0.0" when an outside
   *   proxy must reach them.
   * - `ports`: an inclusive range to take ports from, lowest free first, so
   *   a port is reused once its preview is gone. Omitted ⇒ any free port.
   */
  readonly bind: { host: string; ports?: PortRange }

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

/** An inclusive port range. */
export interface PortRange {
  from: number
  to: number
}
