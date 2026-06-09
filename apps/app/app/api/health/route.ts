/**
 * Liveness probe for the desktop shell's sidecar lifecycle.
 *
 * The Tauri shell spawns the Node sidecar on an OS-assigned ephemeral port and
 * must not point the webview at it until it is actually serving — otherwise the
 * first paint races the server boot. It polls this route and only calls
 * `navigate()` once it gets a 200 (spike #407 measured the first success at
 * ~316 ms after spawn).
 *
 * Deliberately the cheapest possible handler: it reads no env, touches no
 * database or backend, and runs no auth. A 200 here means only "the HTTP server
 * is up and routing" — exactly the signal the shell needs, and a signal that can
 * never itself fail because of misconfiguration. The Node-boot work that the
 * local backends do (`instrumentation.ts`: db migrations, the Yjs and terminal
 * servers) is awaited before the server accepts connections, so by the time this
 * answers, those are ready too.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET(): Response {
  return Response.json({ status: "ok" })
}
