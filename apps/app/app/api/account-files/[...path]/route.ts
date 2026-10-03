import { getUserId } from "@/lib/auth-helpers"
import { accountFiles } from "@/lib/files"
import { fileResponse } from "@/lib/files/response"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Serves one of your Account Files (#1521) to you, and to nobody else: the
 * path is read from the signed-in person's own files, so there is no one
 * else's to ask for. `GET /api/account-files/<path>`.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const userId = await getUserId()
  if (!userId) return new Response("Unauthorized", { status: 401 })
  const { path } = await params

  const result = await accountFiles(userId).read(path.join("/"))
  if (!result.ok) return new Response("Not found", { status: 404 })
  return fileResponse(result.value.entry, result.value.bytes)
}

/**
 * Deletes one of your Account Files, or a folder with everything in it:
 * Settings › Files' Delete. `DELETE /api/account-files/<path>`.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const userId = await getUserId()
  if (!userId) return new Response("Unauthorized", { status: 401 })
  const { path } = await params

  const result = await accountFiles(userId).remove(path.join("/"))
  if (!result.ok) return new Response(result.error, { status: 404 })
  return Response.json(result.value)
}
