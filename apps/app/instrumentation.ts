/**
 * Next.js boot hook. Runs once when the server process starts.
 *
 * - Awaits the database's readiness — for the PGlite desktop backend that means
 *   running migrations on boot before any request is served; for the hosted
 *   neon-http backend `dbReady` resolves immediately, so it's a no-op.
 * - In the local desktop build (`NEXT_PUBLIC_YJS_HOST=local`) boots the
 *   y-websocket server that holds the authoritative Y.Doc and serves it to the
 *   webview. The hosted build leaves this a no-op — Liveblocks is the transport
 *   there.
 */
export async function register() {
  // Only the Node.js server runtime touches the db seam / holds a long-lived
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
}
