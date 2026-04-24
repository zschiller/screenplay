import { NextResponse, type NextRequest } from "next/server"
import { getSessionCookie } from "better-auth/cookies"

// Routes reachable without a session. Everything else bounces to /sign-in.
const PUBLIC_PATHS = [
  "/",
  "/sign-in",
  "/api/auth",
  "/api/yjs/auth",
]

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}

export default function middleware(request: NextRequest) {
  if (isPublic(request.nextUrl.pathname)) return NextResponse.next()

  // Edge-safe cookie presence check. Better Auth validates the session on the
  // server when protected code actually runs — this just keeps unauth users
  // out of the UI.
  const sessionCookie = getSessionCookie(request)
  if (!sessionCookie) {
    const signInUrl = new URL("/sign-in", request.url)
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
