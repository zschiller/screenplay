import { NextResponse, type NextRequest } from "next/server"
import { getSessionCookie } from "better-auth/cookies"
import { isLocalBuild } from "@/lib/local-mode"

// Routes reachable without a session. Everything else bounces to /sign-in.
const PUBLIC_PATHS = ["/", "/sign-in", "/api/auth", "/api/yjs/auth"]

function isPublic(pathname: string): boolean {
  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return true
  }
  // Thumbnail render route: /[roomId]/render. Auth is enforced by the HMAC
  // token check inside the page itself — Puppeteer can't carry a session.
  if (/^\/[^/]+\/render\/?$/.test(pathname)) return true
  return false
}

export default function middleware(request: NextRequest) {
  // The local desktop build has no login screen (PRD #404, issue #417): it runs
  // as the single seeded local user, so nothing is gated behind a session.
  if (isLocalBuild) return NextResponse.next()

  if (isPublic(request.nextUrl.pathname)) return NextResponse.next()

  // Edge-safe cookie presence check. Better Auth validates the session on the
  // server when protected code actually runs — this just keeps unauth users
  // out of the UI.
  const sessionCookie = getSessionCookie(request)
  if (!sessionCookie) {
    // Clone `nextUrl` (not `new URL(..., request.url)`) so the redirect keeps
    // the `/app` basePath — `NextResponse.redirect` won't re-apply it, but the
    // basePath-aware `nextUrl` carries it into the serialized Location.
    const signInUrl = request.nextUrl.clone()
    signInUrl.pathname = "/sign-in"
    return NextResponse.redirect(signInUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
