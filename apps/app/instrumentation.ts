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
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime touches these seams / holds a long-lived
  // WebSocket server (no edge usage).
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  // Desktop only: exit if the Tauri shell that spawned us goes away, so a
  // Ctrl-C / hot-reload / crash of the shell can't leave this sidecar orphaned
  // (holding the Yjs port and the PGlite data dir, which then corrupts the next
  // run). No-op on the hosted build. Started before anything else so it's active
  // even if the boot below stalls.
  const { watchParentShell } = await import("@/lib/desktop/parent-watch")
  watchParentShell()

  const { dbReady } = await import("@/lib/db")
  await dbReady

  const { isLocalBuild } = await import("@/lib/local-mode")
  if (isLocalBuild) {
    // Seed the one identity the local build runs as. Idempotent across reboots.
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

  if (process.env.NEXT_PUBLIC_YJS_HOST === "local") {
    const { startLocalYjsServer } =
      await import("@/lib/yjs-host/y-websocket-server")
    await startLocalYjsServer()
  }

  const { isLocalSandboxBackend } = await import("@/lib/sandbox/backend")
  if (isLocalSandboxBackend()) {
    const { ensureLocalTerminalServer } = await import(
      "@/lib/terminal/local/server"
    )
    await ensureLocalTerminalServer()
  }
}
