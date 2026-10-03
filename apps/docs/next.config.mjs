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
  // The logo (mark and favicon) comes from the shared UI package.
  transpilePackages: ["@workspace/ui"],
  // The Guides, Self-hosting and Contributing tabs (audit H1) moved pages;
  // every old URL keeps working.
  async redirects() {
    return [
      { source: "/", destination: "/guides", permanent: true },
      ...["quickstart", "concepts", "building/:path*"].map((path) => ({
        source: `/${path}`,
        destination: `/guides/${path}`,
        permanent: true,
      })),
      { source: "/development", destination: "/contributing", permanent: true },
      {
        source: "/screenshots",
        destination:
          "https://github.com/zschiller/screenplay/blob/main/apps/app/screenshots/README.md",
        permanent: true,
      },
    ]
  },
}

export default withNextra(nextConfig)
