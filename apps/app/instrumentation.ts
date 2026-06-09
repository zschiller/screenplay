/**
 * Next.js boot hook. Runs once when the server process starts. We use it to
 * await the database's readiness — for the PGlite desktop backend that means
 * running migrations on boot before any request is served; for the hosted
 * neon-http backend `dbReady` resolves immediately, so this is a no-op.
 */
export async function register() {
  // Only the Node.js server runtime touches the db seam (no edge usage).
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { dbReady } = await import("@/lib/db")
  await dbReady
}
