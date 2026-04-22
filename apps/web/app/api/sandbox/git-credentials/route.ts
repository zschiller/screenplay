import { clerkClient } from "@clerk/nextjs/server"
import { verifySandboxAuth } from "@/lib/sandbox-jwt"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Called from inside sandboxes by the git credential helper. Trades a signed
// SCREENPLAY_AUTH JWT (minted by the web app per command) for the acting
// user's GitHub OAuth token. The sandbox never stores a token of its own —
// the JWT is the only thing it holds, and it's short-lived and scoped.
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") ?? ""
  const token = authHeader.replace(/^Bearer\s+/i, "").trim()
  if (!token) {
    return new Response("Missing bearer token", { status: 401 })
  }

  const claims = verifySandboxAuth(token)
  if (!claims) {
    return new Response("Invalid or expired token", { status: 401 })
  }

  const client = await clerkClient()
  const tokens = await client.users.getUserOauthAccessToken(claims.userId, "github")
  const gh = tokens.data?.[0]?.token
  if (!gh) {
    return new Response("No GitHub token for user", { status: 404 })
  }

  return new Response(gh, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}
