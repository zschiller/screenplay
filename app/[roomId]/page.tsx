import { RoomProviderWrapper } from "@/components/providers/liveblocks-provider"
import { Canvas } from "@/components/canvas/canvas"
import { liveblocks } from "@/lib/liveblocks-server"

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>
}) {
  const { roomId } = await params

  let projectName = "Untitled"
  try {
    const room = await liveblocks.getRoom(roomId)
    const raw = room.metadata.name
    if (typeof raw === "string" && raw.length) projectName = raw
  } catch {
    // fall back to default
  }

  return (
    <RoomProviderWrapper roomId={roomId}>
      <Canvas roomId={roomId} projectName={projectName} />
    </RoomProviderWrapper>
  )
}
