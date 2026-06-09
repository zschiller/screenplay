/**
 * Next.js server-boot hook. Runs once per server process, before the first
 * request. We use it for the desktop build's startup work that has to happen
 * before any request is served, and for the sidecar services that need a
 * long-running process the App Router itself can't host:
 *
 *  - **Database readiness.** For the PGlite desktop backend this runs migrations
 *    on boot; for the hosted neon-http backend `dbReady` resolves immediately,
 *    so it's a no-op.
 *  - **Local Yjs host.** In the local desktop build (`NEXT_PUBLIC_YJS_HOST=local`)
 *    boots the y-websocket server that holds the authoritative Y.Doc and serves
 *    it to the webview. The hosted build leaves this a no-op — Liveblocks is the
 *    transport there.
 *  - **Local terminal server.** The node-pty WebSocket transport
 *    (`lib/terminal/local/`) that replaces the hosted build's in-sandbox ttyd
 *    daemon. It exists only on the worktree backend; the hosted (Vercel) build
 *    skips it and keeps the ttyd/`domain(port)` path. The dynamic import keeps
 *    node-pty/`ws` out of the hosted build's graph.
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime touches these seams / holds a long-lived
  // WebSocket server (no edge usage).
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  const { dbReady } = await import("@/lib/db")
  await dbReady

  if (process.env.NEXT_PUBLIC_YJS_HOST === "local") {
    const { startLocalYjsServer } = await import(
      "@/lib/yjs-host/y-websocket-server"
    )
    await startLocalYjsServer()
  }

  if (process.env.SANDBOX_BACKEND === "worktree") {
    const { ensureLocalTerminalServer } = await import(
      "@/lib/terminal/local/server"
    )
    await ensureLocalTerminalServer()
  }
}
