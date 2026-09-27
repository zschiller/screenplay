import { createServer, type Server } from "node:http"

import { BRIDGE_JS } from "@/lib/sandbox-bridge"

import { PREVIEW_WORKSPACE_PREFIX } from "./preview-url"

/**
 * The **fixture preview server** — a static stand-in for the dev servers the
 * Fixture World's Workspaces would otherwise run.
 *
 * An Iframe Layer's `src` is its Branch's `previewDomain` plus the layer's route
 * (`canvas-member-layer.tsx`), and the canvas probes that URL before mounting the
 * iframe. Nothing in the fixture world is a real checkout, so without a server on
 * the other end every frame on every canvas screenshot is the "Waiting for dev
 * server…" spinner — and a canvas capture whose frames are all empty can't
 * review frame chrome, group layout, or the composed thumbnail.
 *
 * So the harness serves the frames itself: one tiny HTTP server, one page per
 * `(workspace, route)` pair, drawn as an obvious wireframe. Booting the real dev
 * servers instead would mean cloning repos and running `pnpm install` per
 * Workspace, which is exactly the setup cost this harness exists to remove.
 *
 * The pages are deliberately **not** mock product screens: flat blocks and the
 * route's own name, so nobody mistakes a fixture for the thing being designed.
 *
 * Each page inlines the **real** Sandbox Bridge (`lib/sandbox-bridge`) rather
 * than faking its handshake. The bridge is what a preview and the canvas talk
 * over — the `screenplay:ready` message that drops the loading overlay, plus
 * navigation reporting, scroll sync, and element targeting — so serving the
 * genuine script means a fixture frame exercises the same path a real Workspace
 * does, including the version check that would otherwise fire a bridge
 * reinstall against a sandbox that doesn't exist.
 */

export interface PreviewServerHandle {
  origin: string
  started: boolean
  stop: () => Promise<void>
}

/** Whether something already answers on the preview port (a `boot` in another terminal). */
export async function isPreviewServerUp(origin: string): Promise<boolean> {
  try {
    const res = await fetch(origin, { signal: AbortSignal.timeout(1500) })
    return res.headers.get("x-screenplay-fixture-preview") === "1"
  } catch {
    return false
  }
}

/** Start the fixture preview server, or reuse one already listening. */
export async function startPreviewServer(
  origin: string,
  port: number
): Promise<PreviewServerHandle> {
  if (await isPreviewServerUp(origin)) {
    return { origin, started: false, stop: async () => {} }
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", origin)
    const { workspace, route } = splitPath(url.pathname)
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      // The marker `isPreviewServerUp` recognises, so a second harness command
      // reuses this server instead of failing to bind its port.
      "x-screenplay-fixture-preview": "1",
      // Frames are same-origin-ish but loaded cross-port; nothing here is secret.
      "cache-control": "no-store",
    })
    res.end(previewPage(workspace, route))
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })

  return { origin, started: true, stop: () => closeServer(server) }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections?.()
    server.close(() => resolve())
  })
}

/** `/w/<workspace>/<route…>` → its two halves, tolerating a bare `/`. */
function splitPath(pathname: string): { workspace: string; route: string } {
  const parts = pathname.split("/").filter(Boolean)
  if (parts[0] !== PREVIEW_WORKSPACE_PREFIX.slice(1) || parts.length < 2) {
    return { workspace: "preview", route: pathname === "/" ? "/" : pathname }
  }
  return { workspace: parts[1]!, route: `/${parts.slice(2).join("/")}` }
}

/**
 * One fixture page.
 *
 * It opens by rewriting its own address to the bare route, dropping the
 * `/w/<workspace>` prefix before the bridge script below it reads the path. A
 * real Workspace's dev server is a whole origin, so the canvas treats the path
 * the bridge reports in `screenplay:navigation` as the frame's *route* and
 * appends it to `previewDomain` again — leave the prefix on and every navigation
 * folds it in once more, so the route grows without bound. It is a same-origin
 * `replaceState`, so nothing reloads, and these pages are fully inline, so there
 * are no relative URLs for it to break.
 *
 * It honors `prefers-color-scheme` too: the frames are a big part of what a
 * dark-mode review is looking at, and a white rectangle punched through each one
 * would defeat the point.
 */
function previewPage(workspace: string, route: string): string {
  const title = route === "/" ? "Home" : route
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(workspace)} ${escapeHtml(title)}</title>
<script>
  history.replaceState(null, "", ${JSON.stringify(route)});
</script>
<script>${BRIDGE_JS}</script>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --fg: #0f172a; --muted: #64748b;
    --block: #e2e8f0; --accent: #6366f1; --line: #e2e8f0;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b1120; --fg: #e2e8f0; --muted: #94a3b8;
      --block: #1e293b; --accent: #818cf8; --line: #1e293b;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 28px; border-bottom: 1px solid var(--line);
  }
  .brand { font-weight: 600; letter-spacing: -0.01em; }
  .nav { display: flex; gap: 18px; color: var(--muted); font-size: 14px; }
  main { padding: 36px 28px 64px; display: grid; gap: 28px; }
  .hero {
    background: var(--accent); border-radius: 14px; min-height: 180px;
    display: flex; align-items: center; padding: 28px; color: #fff;
  }
  .hero h1 { margin: 0; font-size: 28px; letter-spacing: -0.02em; }
  .cols { display: grid; grid-template-columns: 2fr 1fr; gap: 24px; }
  @media (max-width: 720px) { .cols { grid-template-columns: 1fr; } }
  .card { border: 1px solid var(--line); border-radius: 12px; padding: 20px; display: grid; gap: 12px; }
  .bar { height: 12px; border-radius: 6px; background: var(--block); }
  .bar.short { width: 55%; }
  .bar.tall { height: 40px; border-radius: 8px; }
  footer { padding: 20px 28px; color: var(--muted); font-size: 12px; border-top: 1px solid var(--line); }
  .route { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
  <header>
    <div class="brand">${escapeHtml(workspace)}</div>
    <nav class="nav"><span>Shop</span><span>Cart</span><span>Account</span></nav>
  </header>
  <main>
    <section class="hero"><h1>${escapeHtml(title)}</h1></section>
    <section class="cols">
      <div class="card">
        <div class="bar tall"></div>
        <div class="bar"></div>
        <div class="bar short"></div>
        <div class="bar"></div>
        <div class="bar short"></div>
      </div>
      <aside class="card">
        <div class="bar short"></div>
        <div class="bar tall"></div>
        <div class="bar"></div>
      </aside>
    </section>
  </main>
  <footer>Screenplay screenshot fixture · <span class="route">${escapeHtml(route)}</span> · not a real page</footer>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!
  )
}
