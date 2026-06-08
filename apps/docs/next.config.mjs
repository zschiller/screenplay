import nextra from "nextra"

const withNextra = nextra({})

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The marketing `web` app proxies `/docs/*` to this project (see
  // apps/web/vercel.json); `basePath` serves the docs site — index, nested
  // routes, Nextra assets — beneath the `/docs` prefix. Wrapped by Nextra
  // below so the config still flows through `withNextra`.
  basePath: "/docs",
}

export default withNextra(nextConfig)
