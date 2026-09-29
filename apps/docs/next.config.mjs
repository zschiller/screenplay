import nextra from "nextra"
import { ansiCodeTheme } from "./ansi-code-theme.mjs"

const withNextra = nextra({
  // Code blocks in the terminal's ANSI palette, for both themes (#1104).
  mdxOptions: {
    rehypePrettyCodeOptions: {
      theme: { light: ansiCodeTheme, dark: ansiCodeTheme },
    },
  },
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The marketing `web` app proxies `/docs/*` to this project (see
  // apps/homepage/vercel.json); `basePath` serves the docs site — index, nested
  // routes, Nextra assets — beneath the `/docs` prefix. Wrapped by Nextra
  // below so the config still flows through `withNextra`.
  basePath: "/docs",
  // The deployment's own root is empty under `basePath`, so Vercel's dashboard
  // (and anything else that probes `/` or `/favicon.ico`) finds no favicon.
  // Point both at the docs. Redirects, because Next only rewrites outside
  // `basePath` to external URLs.
  async redirects() {
    return [
      { source: "/", destination: "/docs", basePath: false, permanent: false },
      {
        source: "/favicon.ico",
        destination: "/docs/icon.svg",
        basePath: false,
        permanent: false,
      },
    ]
  },
  // The logo (mark and favicon) comes from the shared UI package.
  transpilePackages: ["@workspace/ui"],
}

export default withNextra(nextConfig)
