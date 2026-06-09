// Mount prefix for the product. Empty by default (served at root); set to a
// path like `/app` to serve every page, `_next/static` asset, and route handler
// beneath it. This file is plain Node config loaded before the TS pipeline, so
// it can't import lib/base-path.ts — both read the same env var to stay in sync.
// In this monorepo the `web` app proxies `/app/*` here (see apps/web/vercel.json)
// and the `app` Vercel project sets NEXT_PUBLIC_BASE_PATH=/app.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "")

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Omit the key entirely when empty — Next rejects basePath: "".
  ...(basePath ? { basePath } : {}),
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
    // The desktop build's local terminal transport: node-pty is a native addon
    // and must not be bundled.
    "node-pty",
  ],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
}

export default nextConfig
