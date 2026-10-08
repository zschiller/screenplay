/**
 * Next.js server-boot hook. Runs once per server process, before the first
 * request. We use it for the desktop build's startup work that has to happen
 * before any request is served, and for the sidecar services that need a
 * long-running process the App Router itself can't host:
 *
 *  - **Database readiness.** For the PGlite desktop backend this runs migrations
 *    on boot; for the hosted neon-http backend `dbReady` resolves immediately,
 *    so it's a no-op.
 *  - **Local user seed.** In the local desktop build (PRD #404, issue #417) seeds
 *    the single local user the whole app runs as, so room/terminal_tab foreign
 *    keys to `user` resolve without a login.
 *  - **Local Yjs host.** In the local desktop build (`NEXT_PUBLIC_YJS_HOST=local`)
 *    boots the y-websocket server that holds the authoritative Y.Doc and serves
 *    it to the webview. The hosted build leaves this a no-op — Liveblocks is the
 *    transport there.
 *  - **Local terminal server.** The node-pty WebSocket transport
 *    (`lib/terminal/local/`) that replaces the hosted build's in-sandbox ttyd
 *    daemon. It exists only on the local sandbox backend; the hosted (Vercel)
 *    build skips it and keeps the ttyd/`domain(port)` path. The dynamic import
 *    keeps node-pty/`ws` out of the hosted build's graph.
 *  - **Seam overrides.** Runs the select modules for GitHub access and preview
 *    exposure first, so an override they don't know (`GITHUB_ACCESS`,
 *    `PREVIEW_EXPOSURE`) refuses start.
 *  - **PR Watch tick.** In the local desktop build, looks at every canvas with
 *    an open PR once a minute (#1702), so PR events reach chats with no canvas
 *    open. The hosted build runs the same tick from Vercel Cron instead
 *    (`app/api/pr-watch/tick`).
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime touches these seams / holds a long-lived
  // WebSocket server (no edge usage).
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  // A seam override the select module doesn't know refuses start with its
  // message, rather than failing on first use.
  try {
    const { selectGitHubAccess } = await import("@/lib/github-access")
    const { selectPreviewExposure } = await import("@/lib/preview-exposure")
    selectGitHubAccess()
    selectPreviewExposure()
    // Sharing (the Mac app): the front server asks this identity who each
    // request on a viewer listener is from, before Next sees it.
    const { viewers } = await import("@/lib/capabilities")
    if (viewers) {
      const { selectViewerIdentity } = await import("@/lib/viewer-identity")
      const { setViewerIdentity } = await import("@/server/viewer.mjs")
      const { id, identity } = selectViewerIdentity()
      setViewerIdentity(id, identity)
    }
  } catch (err) {
    console.error(
      `Screenplay won’t start: ${err instanceof Error ? err.message : err}`
    )
    process.exit(1)
  }

  // Desktop only: exit if the Tauri shell that spawned us goes away, so a
  // Ctrl-C / hot-reload / crash of the shell can't leave this sidecar orphaned
  // (holding the Yjs port and the PGlite data dir, which then corrupts the next
  // run). No-op on the hosted build. Started before anything else so it's active
  // even if the boot below stalls.
  const { watchParentShell } = await import("@/lib/desktop/parent-watch")
  watchParentShell()

  // A thumbnail capture tearing down headless Chromium mid-navigation (or an
  // aborted keepalive heartbeat POST) resets an in-flight connection to this
  // server; Node would otherwise treat that benign `ECONNRESET` as a fatal
  // uncaughtException and take the whole sidecar down. Armed before the
  // long-lived servers below so a reset can never crash them.
  const { installSocketResetGuard } =
    await import("@/lib/desktop/socket-reset-guard")
  installSocketResetGuard()

  // Desktop only: the local backend's dev servers / proxies / terminals are
  // detached host process groups, so they'd outlive this sidecar unless someone
  // reaps them. Installed before the boot work below so the exit hook is armed
  // even if boot stalls: sweeps the pidfiles a previous run left behind (a
  // force-killed sidecar can never clean up after itself) and re-sweeps on exit
  // (Tauri's clean quit sends SIGTERM — see sidecar.rs — and parent-watch's
  // self-exit lands here too).
  const { isLocalSandboxBackend } = await import("@/lib/sandbox/backend")
  if (isLocalSandboxBackend()) {
    const { installLocalSandboxReaper } =
      await import("@/lib/sandbox/local/reaper")
    installLocalSandboxReaper()
  }

  const { dbReady } = await import("@/lib/db")
  await dbReady

  const { backendSwitch, buildIdentity } = await import("@/lib/capabilities")
  if (buildIdentity === "host") {
    // Seed the one identity the host runs as. Idempotent across reboots.
    const { db, schema } = await import("@/lib/db")
    const { LOCAL_USER } = await import("@/lib/local-user")
    await db
      .insert(schema.user)
      .values({
        id: LOCAL_USER.id,
        name: LOCAL_USER.name,
        email: LOCAL_USER.email,
      })
      .onConflictDoNothing()
  }

  // On Headless the host listener carries both socket servers under a path
  // (`server/ws-routes.mjs`), so they take any free loopback port and say
  // which; elsewhere the client connects to their ports directly.
  const { hostTunnel } = await import("@/lib/capabilities")
  const { setLocalWsPort } = await import("@/server/ws-routes.mjs")

  if (backendSwitch("NEXT_PUBLIC_YJS_HOST") === "local") {
    const { startLocalYjsServer } =
      await import("@/lib/yjs-host/y-websocket-server")
    const yjs = await startLocalYjsServer(hostTunnel ? { port: 0 } : {})
    setLocalWsPort("yjs", yjs.port)
  }

  if (isLocalSandboxBackend()) {
    const { ensureLocalTerminalServer } =
      await import("@/lib/terminal/local/server")
    const terminal = await ensureLocalTerminalServer()
    setLocalWsPort("terminal", terminal.port)
  }

  if (buildIdentity === "host") {
    const { startPrWatchInterval } = await import("@/lib/pr-watch/interval")
    startPrWatchInterval()
  }
}
