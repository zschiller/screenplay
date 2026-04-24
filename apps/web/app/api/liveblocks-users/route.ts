import { NextResponse } from "next/server"
import { getUsersByIds } from "@/lib/auth-server"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const userIds = searchParams.getAll("userIds")
  if (!userIds.length) {
    return NextResponse.json([])
  }

  const users = await getUsersByIds(userIds)

  const result = userIds.map((id) => {
    const user = users.find((u) => u.id === id)
    if (!user) return undefined
    const name = user.name?.trim() || user.email || "Anonymous"
    return { name, avatar: user.image ?? undefined }
  })

  return NextResponse.json(result)
}
