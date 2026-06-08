import { auth } from "@/lib/auth"
import { BASE_PATH } from "@/lib/base-path"

// Better Auth is configured with `basePath: "/app/api/auth"` so every URL it
// generates — the OAuth `redirect_uri`, the `oAuthProxy` callback, post-sign-in
// redirects — carries the product's `/app` prefix. But Next.js strips that
// basePath from `request.url` before it reaches route handlers, while Better
// Auth matches incoming requests against the same `basePath`. Re-add the prefix
// Next removed so routing and URL generation agree.
function withBasePath(request: Request): Request {
  const url = new URL(request.url)
  if (url.pathname.startsWith(`${BASE_PATH}/`)) return request
  url.pathname = `${BASE_PATH}${url.pathname}`
  return new Request(url, request)
}

const handler = (request: Request) => auth.handler(withBasePath(request))

export { handler as GET, handler as POST }
