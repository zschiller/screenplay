// Mount prefix for the product. Empty by default (served at root); set to a
// path like `/app` to serve every page, `_next/static` asset, and route handler
// beneath it. This file is plain Node config loaded before the TS pipeline, so
// it can't import lib/base-path.ts — both read the same env var to stay in sync.
// In this monorepo the `web` app proxies `/app/*` here (see apps/web/vercel.json)
// and the `app` Vercel project sets NEXT_PUBLIC_BASE_PATH=/app.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "")

// The desktop build (issue #418) bundles the app as a Node sidecar inside the
// Tauri shell. `output: "standalone"` emits the self-contained `.next/standalone`
// tree (server + traced node_modules) that the shell ships and runs with host
// `node`. Gated on its own flag so the hosted Vercel build is untouched — there
// Vercel owns the server and standalone tracing would only add build cost.
const isDesktopBuild = process.env.SCREENPLAY_DESKTOP === "1"

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Omit the key entirely when empty — Next rejects basePath: "".
  ...(basePath ? { basePath } : {}),
  ...(isDesktopBuild ? { output: "standalone" } : {}),
  // Next 16.2 blocks cross-origin requests to dev resources (HMR, /_next/*) by
  // default. The Tauri desktop shell loads the sidecar over a loopback host that
  // doesn't always match the server's own origin, so HMR is rejected with a
  // "Blocked cross-origin request" warning. Allow the loopback hosts the shell
  // uses in dev. Dev-only — the key is ignored by production builds.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  transpilePackages: ["@workspace/ui"],
  serverExternalPackages: [
    "@sparticuz/chromium",
    "puppeteer-core",
    "puppeteer",
    // PGlite ships a WASM build of Postgres; keep it external so the bundler
    // doesn't try to inline the .wasm (it's loaded from node_modules at runtime,
    // and only on the desktop build that selects SCREENPLAY_DB=pglite).
    "@electric-sql/pglite",
    // `ws` runs in the Node sidecar for two local-build services: the Yjs host's
    // WebSocket server (CJS `y-websocket` `bin/utils`) and the node-pty terminal
    // transport. Keep it and `y-websocket` unbundled so they resolve at runtime.
    "ws",
    "y-websocket",
    // `y-websocket/bin/utils` requires `y-protocols`, which in turn requires
    // `yjs` from node_modules at runtime. Server code here also `import`s `yjs`
    // (and `y-protocols`) directly — if those stay bundled, the sidecar ends up
    // with two copies and Yjs logs "Yjs was already imported. This breaks
    // constructor checks" (yjs#438), with cross-instance constructor checks
    // silently failing. Externalize them so every server importer shares the
    // single node_modules copy that the external `y-websocket` resolves.
    "yjs",
    "y-protocols",
    // The desktop build's local terminal transport: node-pty is a native addon
    // and must not be bundled.
    "node-pty",
    // The local GitHub token store's OS-keychain backend (PRD #428): a native
    // addon, loaded dynamically and only on the local build.
    "@napi-rs/keyring",
    // Deterministic settings detection (PRD #673) runs server-only behind the
    // `detectSettings` seam. Keep build-info external so its dynamic requires
    // (and `@bugsnag/js`) resolve from node_modules rather than being inlined.
    "@netlify/build-info",
  ],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
}

export default nextConfig
