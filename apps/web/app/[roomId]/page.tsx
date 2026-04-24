import { notFound, redirect } from "next/navigation"
import { RoomProviderWrapper } from "@/components/providers/liveblocks-provider"
import { Canvas } from "@/components/canvas/canvas"
import { getUserId } from "@/lib/auth-helpers"
import { ensureRoomBackfilled } from "@/lib/projects-actions"
import { canAccess, getRoom, touchRoomOpened } from "@/lib/rooms"

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>
}) {
  const { roomId } = await params

  const userId = await getUserId()
  if (!userId) redirect(`/sign-in?redirect=/${roomId}`)

  let room = await getRoom(roomId)
  if (!room) {
    // Possibly a room created before the Postgres migration; try a one-shot
    // backfill from Liveblocks before giving up.
    await ensureRoomBackfilled(roomId, userId)
    room = await getRoom(roomId)
  }
  if (!room) notFound()

  if (!(await canAccess(roomId, userId))) notFound()

  // Best-effort: don't block render if the timestamp update fails.
  touchRoomOpened(roomId).catch(() => {})

  return (
    <RoomProviderWrapper roomId={roomId}>
      <Canvas roomId={roomId} projectName={room.name} />
    </RoomProviderWrapper>
  )
}
