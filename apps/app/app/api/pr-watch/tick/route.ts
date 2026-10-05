import { timingSafeEqual } from "node:crypto"
import { runPrWatchTick } from "@/lib/pr-watch/run"

/**
 * The hosted backend's PR Watch tick (#1702): Vercel Cron calls it on the
 * schedule in `vercel.json`, so PR events reach Workspace Chats with nobody's
 * canvas open. Vercel sends `Authorization: Bearer $CRON_SECRET`; without the
 * secret set, the route refuses every call. The desktop build runs the same
 * tick on an interval instead (`instrumentation.ts`).
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(request.headers.get("authorization") ?? "")
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return new Response("Unauthorized", { status: 401 })
  }
  return Response.json(await runPrWatchTick())
}
