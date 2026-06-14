import type { Metadata } from "next"
import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { Canvas } from "@/components/canvas/canvas"
import { CanvasSkeleton } from "@/components/canvas/canvas-skeleton"
import { getUserId } from "@/lib/auth-helpers"
import { listThreads } from "@/lib/comments"
import { getRoomParentFolderForUser } from "@/lib/folders"
import {
  panelLayoutCookieName,
  parsePanelLayoutValue,
} from "@/lib/panel-layout"
import { isLocalBuild } from "@/lib/local-mode"
import {
  canAccess,
  getMemberCounts,
  getRoom,
  touchRoomOpened,
} from "@/lib/rooms"
import { listTerminalTabs } from "@/lib/terminal-tabs"
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

  // Resolve the room and the access check together — neither depends on the
  // other, and running them sequentially adds a round-trip to the open path.
  const [room, access] = await Promise.all([
    getRoom(roomId),
    canAccess(roomId, userId),
  ])
  if (!room) notFound()
  if (!access) notFound()

  // Best-effort: don't block render if the timestamp update fails.
  touchRoomOpened(roomId).catch(() => {})

  const cookieStore = await cookies()
  const initialLayout = parsePanelLayoutValue(
    cookieStore.get(panelLayoutCookieName("canvas-layout"))?.value
  )

  // Pre-fetch threads and this User's terminal tabs server-side so comment pins
  // and restored terminals render on the very first client paint. The
  // equivalent client-side server actions get queued behind the iframeLayer's
  // probeSandboxUrl polling and otherwise wouldn't resolve until the dev
  // server's iframe URL is up — making pins look like they were waiting on the
  // iframe and terminal tabs pop in late. Fetched in parallel since they're
  // independent.
  // Member count feeds the shared-aware delete confirm in the breadcrumb menu.
  // The local build has no `room_member` table and no sharing, so report 0.
  // The breadcrumb's parent crumb points at the folder this user filed the Room
  // into ("All files" root when unfiled), so it returns to the Room's actual
  // home rather than always "Home".
  const [initialThreads, initialTerminalTabs, memberCounts, parentFolder] =
    await Promise.all([
      listThreads(roomId, userId).catch(() => []),
      listTerminalTabs({ userId, roomId }).catch(() => []),
      isLocalBuild
        ? Promise.resolve(new Map<string, number>())
        : getMemberCounts([roomId]).catch(() => new Map<string, number>()),
      getRoomParentFolderForUser(userId, roomId).catch(() => null),
    ])
  const isOwner = room.ownerId === userId
  const sharedWithCount = Math.max(0, (memberCounts.get(roomId) ?? 1) - 1)

  return (
    <YjsRoomProvider
      roomId={roomId}
      fallback={<CanvasSkeleton initialLayout={initialLayout} />}
    >
      <Canvas
        roomId={roomId}
        roomName={room.name}
        isOwner={isOwner}
        sharedWithCount={sharedWithCount}
        hasThumbnail={!!room.thumbnailManifest}
        parentFolder={parentFolder}
        initialLayout={initialLayout}
        initialThreads={initialThreads}
        initialTerminalTabs={initialTerminalTabs}
      />
    </YjsRoomProvider>
  )
}
