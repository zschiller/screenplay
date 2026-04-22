import { auth } from "@clerk/nextjs/server"
import { Sandbox } from "@vercel/sandbox"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { userId } = await auth()
  if (!userId) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { name } = await params
  try {
    const sandbox = await Sandbox.get({ name, resume: false })
    if (sandbox.status !== "running") {
      return new Response("Sandbox not running", { status: 409 })
    }
    return new Response("OK", { status: 200 })
  } catch {
    return new Response("Sandbox not found", { status: 404 })
  }
}
