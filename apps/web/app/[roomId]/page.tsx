import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { Canvas } from "@/components/canvas/canvas"
import { CanvasSkeleton } from "@/components/canvas/canvas-skeleton"
import { getUserId } from "@/lib/auth-helpers"
import { canAccess, getRoom, touchRoomOpened } from "@/lib/rooms"
import { YjsRoomProvider } from "@/lib/yjs-host/client"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ roomId: string }>
}): Promise<Metadata> {
  const { roomId } = await params
  const room = await getRoom(roomId)
  return { title: room?.name ?? "Project" }
}

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>
}) {
  const { roomId } = await params

  const userId = await getUserId()
  if (!userId) redirect(`/sign-in?redirect=/${roomId}`)

  const room = await getRoom(roomId)
  if (!room) notFound()

  if (!(await canAccess(roomId, userId))) notFound()

  // Best-effort: don't block render if the timestamp update fails.
  touchRoomOpened(roomId).catch(() => {})

  return (
    <YjsRoomProvider roomId={roomId} fallback={<CanvasSkeleton />}>
      <Canvas roomId={roomId} projectName={room.name} />
    </YjsRoomProvider>
  )
}
