import { clerkClient } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const userIds = searchParams.getAll("userIds")
  if (!userIds.length) {
    return NextResponse.json([])
  }

  const client = await clerkClient()
  const users = await client.users.getUserList({ userId: userIds })

  const result = userIds.map((id) => {
    const user = users.data.find((u) => u.id === id)
    if (!user) return undefined
    const name =
      user.firstName && user.lastName
        ? `${user.firstName} ${user.lastName}`
        : user.username ?? "Anonymous"
    return { name, avatar: user.imageUrl }
  })

  return NextResponse.json(result)
}
