import { auth } from "@/lib/auth"
import { BASE_PATH } from "@/lib/base-path"
import { isLocalBuild } from "@/lib/local-mode"

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

const handler = (request: Request) => {
  // The local desktop build (PRD #404, issue #417) has no GitHub OAuth — Better
  // Auth is never configured there. Answer the only request the client still
  // makes (`get-session`) with "no session" and refuse the rest, without ever
  // constructing `auth` (which would throw on the missing OAuth env).
  if (isLocalBuild) {
    return new Response("null", {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
  return auth.handler(withBasePath(request))
}

export { handler as GET, handler as POST }
