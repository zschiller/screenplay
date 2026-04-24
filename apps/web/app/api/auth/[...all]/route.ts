import { toNextJsHandler } from "better-auth/next-js"
import { auth } from "@/lib/auth"
import { ensureSchema } from "@/lib/db"

const handler = toNextJsHandler(auth.handler)

export async function GET(req: Request) {
  await ensureSchema()
  return handler.GET(req)
}

export async function POST(req: Request) {
  await ensureSchema()
  return handler.POST(req)
}
