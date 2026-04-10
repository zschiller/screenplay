import { RoomProviderWrapper } from "@/components/providers/liveblocks-provider"
import { Canvas } from "@/components/canvas/canvas"

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>
}) {
  const { roomId } = await params

  return (
    <RoomProviderWrapper roomId={roomId}>
      <Canvas />
    </RoomProviderWrapper>
  )
}
