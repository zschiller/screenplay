/** @type {import('next').NextConfig} */
const nextConfig = {
  // The marketing `web` app owns the apex domain and proxies `/app/*` here
  // (see apps/web/vercel.json); `basePath` makes the product serve every page,
  // `_next/static` asset, and route handler beneath the `/app` prefix. Keep in
  // sync with `BASE_PATH` in lib/base-path.ts — this file is plain Node config
  // loaded before the TS pipeline, so it can't import that module.
  basePath: "/app",
  transpilePackages: ["@workspace/ui"],
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core", "puppeteer"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
}

export default nextConfig
