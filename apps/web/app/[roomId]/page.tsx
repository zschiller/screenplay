import type { Metadata } from "next"
import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { Canvas } from "@/components/canvas/canvas"
import { CanvasSkeleton } from "@/components/canvas/canvas-skeleton"
import { getUserId } from "@/lib/auth-helpers"
import { listThreads } from "@/lib/comments"
import { getOrganization } from "@/lib/organization-actions"
import {
  panelLayoutCookieName,
  parsePanelLayoutValue,
} from "@/lib/panel-layout"
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

  const org = await getOrganization().catch(() => null)
  const parentFolderId = org?.fileFolder[roomId]
  const parentFolderName = parentFolderId
    ? (org?.folders.find((f) => f.id === parentFolderId)?.name ?? "Drafts")
    : "Drafts"

  const cookieStore = await cookies()
  const initialLayout = parsePanelLayoutValue(
    cookieStore.get(panelLayoutCookieName("canvas-layout"))?.value,
  )

  // Pre-fetch threads server-side so comment pins render on the very first
  // client paint. The equivalent client-side server action gets queued behind
  // the iframeLayer's probeSandboxUrl polling and otherwise wouldn't resolve
  // until the dev server's iframe URL is up — making pins look like they
  // were waiting on the iframe.
  const initialThreads = await listThreads(roomId, userId).catch(() => [])

  return (
    <YjsRoomProvider
      roomId={roomId}
      fallback={<CanvasSkeleton initialLayout={initialLayout} />}
    >
      <Canvas
        roomId={roomId}
        roomName={room.name}
        hasThumbnail={!!room.thumbnailUrl}
        parentFolderName={parentFolderName}
        initialLayout={initialLayout}
        initialThreads={initialThreads}
      />
    </YjsRoomProvider>
  )
}
