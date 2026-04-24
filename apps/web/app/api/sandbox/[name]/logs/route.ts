import { getUserId } from "@/lib/auth-helpers"
import { Sandbox } from "@vercel/sandbox"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const userId = await getUserId()
  if (!userId) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { name } = await params
  const followOnly = new URL(req.url).searchParams.get("followOnly") === "1"

  let sandbox: Awaited<ReturnType<typeof Sandbox.get>>
  try {
    sandbox = await Sandbox.get({ name, resume: false })
  } catch {
    return new Response("Sandbox not found", { status: 404 })
  }
  if (sandbox.status !== "running") {
    return new Response("Sandbox not running", { status: 409 })
  }

  const lineArg = followOnly ? "0" : "1000"
  const cmd = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `mkdir -p /tmp/screenplay && touch /tmp/screenplay/sandbox.log && exec tail -n ${lineArg} -F /tmp/screenplay/sandbox.log`,
    ],
    detached: true,
  })

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const iter = cmd.logs({ signal: req.signal })
      try {
        for await (const log of iter) {
          controller.enqueue(encoder.encode(log.data))
        }
      } catch {
        // abort / network — fall through to cleanup
      }
      try {
        controller.close()
      } catch {}
    },
    async cancel() {
      try {
        await cmd.kill()
      } catch {}
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  })
}
